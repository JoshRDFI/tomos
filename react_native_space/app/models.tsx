import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, ScrollView, Alert } from 'react-native';
import { Text, Button, useTheme, Card, Chip, IconButton, Menu, Dialog, Portal, TextInput as PaperInput, ActivityIndicator, RadioButton, Snackbar, ProgressBar } from 'react-native-paper';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, radii, fontFamilies, typeScale } from '@/constants/theme';
import { useModelContext } from '@/contexts/ModelContext';
import * as db from '@/lib/db';
import { parseQuantFromFilename, formatBytes, memoryHint, isPrismOnlyQuant } from '@/lib/gguf';
import { base64ToBytes, checkCompatibility, GgufError, readGgufHeader, type CompatibilityReport } from '@/lib/ggufHeader';
import { prepareModel } from '@/lib/modelMeta';
import { finishModel } from '@/lib/modelImport';
import type { ModelRecord, TemplateKey } from '@/types';
import { TEMPLATE_OPTIONS } from '@/types';
import WebNotice from '@/components/WebNotice';
import * as downloader from '@/lib/downloader';
import type { DlInfo } from '@/lib/downloader';
import { cancelDownload, removeDownloadedModelFiles, retryFailed, syncDownloads } from '@/lib/downloads';
import type { DownloadRecord } from '@/types';

// DownloadManager PAUSED_* reasons.
const PAUSED_QUEUED_FOR_WIFI = 3;

function downloadProgress(d: DownloadRecord, infos: Map<number, DlInfo>) {
  let done = 0;
  let paused: number | null | undefined;
  for (const p of d.parts) {
    if (p.status === 'done') done += p.size;
    else if (p.status === 'active') {
      const i = infos.get(p.dmId);
      done += i?.bytesSoFar ?? 0;
      if (i?.status === 'paused') paused = i.reason;
    }
  }
  let line: string | null = null;
  if (d.status === 'failed') line = d.error ?? 'The download failed.';
  else if (paused !== undefined) line = paused === PAUSED_QUEUED_FOR_WIFI ? 'Waiting for Wi-Fi' : 'Paused, retrying';
  return { done: Math.min(done, d.totalBytes), line };
}

interface CompatWarning {
  name: string;
  /** Tensor formats this llama.cpp lacks. */
  types: string[];
  /** File name says PQ2_0 / PTQ1_0. */
  prism: boolean;
  /** Already copied: the choice is keep or remove. */
  copied: boolean;
}

export default function ModelsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();
  const modelCtx = useModelContext();
  const isWeb = Platform.OS === 'web';

  const [models, setModels] = useState<ModelRecord[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [totalRam, setTotalRam] = useState(0);
  const [menuModel, setMenuModel] = useState<string | null>(null);
  const [templateDialog, setTemplateDialog] = useState<ModelRecord | null>(null);
  const [templateChoice, setTemplateChoice] = useState<TemplateKey>('auto');
  const [renameDialog, setRenameDialog] = useState<ModelRecord | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<ModelRecord | null>(null);
  // "This model may not load" warning before an import; resolves true to import anyway.
  const [compatWarning, setCompatWarning] = useState<CompatWarning | null>(null);
  const compatResolve = useRef<((proceed: boolean) => void) | null>(null);
  const askImportAnyway = useCallback((w: CompatWarning) =>
    new Promise<boolean>((resolve) => {
      compatResolve.current = resolve;
      setCompatWarning(w);
    }), []);
  const answerCompat = useCallback((proceed: boolean) => {
    compatResolve.current?.(proceed);
    compatResolve.current = null;
    setCompatWarning(null);
  }, []);
  // After a successful import: offer to delete the picked original, since
  // the import is a copy and models are several GB.
  const [originalPrompt, setOriginalPrompt] = useState<{ name: string; uri: string; size: number } | null>(null);
  const [snack, setSnack] = useState('');
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [dlInfos, setDlInfos] = useState<Map<number, DlInfo>>(new Map());
  const canDownload = !isWeb && downloader.isSupported();

  const refresh = useCallback(async () => {
    if (isWeb) return;
    let m = await db.getAllModels();
    // Fix labels from older versions that read e.g. PQ2_0 as Q2_0.
    const relabel = m.filter((x) => {
      const q = parseQuantFromFilename(x.fileName);
      return q !== null && q !== x.quantization;
    });
    if (relabel.length > 0) {
      for (const x of relabel) await db.updateModel(x.id, { quantization: parseQuantFromFilename(x.fileName) });
      m = await db.getAllModels();
    }
    setModels(m);
    try {
      const { Paths } = await import('expo-file-system');
      // free space check not available via new API; skip if unavailable
    } catch {}
    try {
      const Device = await import('expo-device');
      setTotalRam((Device as any)?.totalMemory ?? 0);
    } catch {}
  }, [isWeb]);

  useEffect(() => { refresh(); }, [refresh]);

  // Hugging Face downloads: reconcile with DownloadManager on focus and every
  // second while this screen is showing.
  const polling = useRef(false);
  const pollDownloads = useCallback(async () => {
    // Skip a tick while the last one runs (finishing a large model takes seconds),
    // so results don't arrive out of order or repeat the snackbar.
    if (!canDownload || polling.current) return;
    polling.current = true;
    try {
      const { finished } = await syncDownloads();
      if (finished.length > 0) {
        refresh();
        setSnack(finished.length === 1 ? 'Model downloaded' : `${finished.length} models downloaded`);
      }
      const list = await db.getActiveDownloads();
      setDownloads(list);
      const ids = list.flatMap((d) => d.parts.filter((p) => p.status === 'active').map((p) => p.dmId));
      setDlInfos(new Map((ids.length ? await downloader.query(ids) : []).map((i) => [i.id, i])));
    } catch (e) {
      console.warn('Download sync failed', e);
    } finally {
      polling.current = false;
    }
  }, [canDownload, refresh]);

  useFocusEffect(useCallback(() => {
    pollDownloads();
    const t = setInterval(pollDownloads, 1000);
    return () => clearInterval(t);
  }, [pollDownloads]));

  const onCancelDownload = useCallback(async (d: DownloadRecord) => {
    await cancelDownload(d);
    pollDownloads();
  }, [pollDownloads]);

  const onRetryDownload = useCallback(async (d: DownloadRecord) => {
    try {
      await retryFailed(d);
    } catch (e) {
      setSnack('Retry failed: ' + String((e as any)?.message ?? e));
    }
    pollDownloads();
  }, [pollDownloads]);

  const addModel = useCallback(async () => {
    if (isWeb) return;
    // Destination of the copy, so a failed import doesn't leave a multi-GB
    // orphan file behind in app storage.
    let copiedFile: { exists: boolean; delete: () => void } | null = null;
    try {
      const DocPicker = await import('expo-document-picker');
      const result = await DocPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? '';
      if (!name.toLowerCase().endsWith('.gguf')) {
        setSnack('Not a GGUF file. Only .gguf models are supported.');
        return;
      }

      setImporting(true);
      setImportMsg(`Checking ${name}…`);
      const { readAsStringAsync, EncodingType, copyAsync } = await import('expo-file-system/legacy');
      const { Paths, File, Directory } = await import('expo-file-system');
      const nameQuant = parseQuantFromFilename(name);
      const prism = isPrismOnlyQuant(nameQuant);
      const stop = (msg?: string) => {
        setImporting(false);
        setImportMsg('');
        if (msg) setSnack(msg);
      };

      // Warn about formats this llama.cpp can't load. The header is read
      // straight from the picked file when Android allows it (files picked
      // from phone storage), before copying gigabytes; otherwise (e.g. the
      // Downloads provider) from the copy, right after copying.
      const total = asset.size ?? Infinity;
      let report: CompatibilityReport | null = null;
      try {
        report = checkCompatibility(await readGgufHeader(async (offset, length) => {
          const len = Math.min(length, total - offset);
          if (len <= 0) return new Uint8Array(0);
          return base64ToBytes(await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64, position: offset, length: len }));
        }));
      } catch (e) {
        if (e instanceof GgufError) return stop(`Can't import ${name}: ${e.message}.`);
        // This picker URI can't be read in parts; check after copying.
      }
      if ((report && !report.ok) || (report && prism)) {
        const proceed = await askImportAnyway({ name, types: report.unsupportedTypes, prism, copied: false });
        if (!proceed) return stop();
      }
      const checkedBeforeCopy = report !== null;
      setImportMsg(`Importing ${name}… keep the app open`);

      const modelsDir = new Directory(Paths.document, 'models');
      if (!modelsDir.exists) {
        modelsDir.create();
      }
      const id = db.generateId();
      const destFileName = `${id}-${name}`;
      const dest = new File(modelsDir, destFileName);

      // The picker returns a content:// URI. The new File API can't copy from
      // those (it needs a real path), so use the legacy copyAsync, which
      // streams through the content resolver without loading the file into memory.
      copiedFile = dest;
      await copyAsync({ from: asset.uri, to: dest.uri });

      if (!checkedBeforeCopy) {
        setImportMsg(`Checking ${name}…`);
        const handle = dest.open();
        try {
          report = checkCompatibility(await readGgufHeader(async (offset, length) => {
            handle.offset = offset;
            return handle.readBytes(Math.max(0, Math.min(length, (handle.size ?? Infinity) - offset)));
          }));
        } catch (e) {
          if (e instanceof GgufError) {
            handle.close();
            dest.delete();
            copiedFile = null;
            return stop(`Can't import ${name}: ${e.message}.`);
          }
          console.warn('GGUF header check failed', e);
        } finally {
          try { handle.close(); } catch {}
        }
        if ((report && !report.ok) || prism) {
          const keep = await askImportAnyway({ name, types: report?.unsupportedTypes ?? [], prism, copied: true });
          if (!keep) {
            dest.delete();
            copiedFile = null;
            return stop();
          }
        }
      }

      const fileSize = asset.size || dest.size || 0;

      await finishModel({ id, fileName: name, filePath: dest.uri, fileSizeBytes: fileSize, fileType: report?.fileType ?? null });
      copiedFile = null; // owned by the model record now
      setImporting(false);
      setImportMsg('');
      refresh();
      setOriginalPrompt({ name, uri: asset.uri, size: fileSize });
    } catch (e) {
      try { if (copiedFile?.exists) copiedFile.delete(); } catch {}
      setImporting(false);
      setImportMsg('');
      setSnack('Import failed: ' + String((e as any)?.message ?? e));
    }
  }, [isWeb, refresh]);

  const deleteOriginal = useCallback(async () => {
    const original = originalPrompt;
    setOriginalPrompt(null);
    if (!original) return;
    try {
      // content:// URI from ACTION_OPEN_DOCUMENT: the new File API deletes it
      // through DocumentsContract, which works when the picker granted write
      // access and the provider (Downloads, phone storage) supports deleting.
      const { File } = await import('expo-file-system');
      new File(original.uri).delete();
      setSnack('Model added. Original deleted.');
    } catch (e) {
      console.warn('Deleting the original failed', e);
      setSnack(`Model added, but the original couldn't be deleted. Delete ${original.name} in the Files app.`);
    }
  }, [originalPrompt]);

  const keepOriginal = useCallback(() => {
    setOriginalPrompt(null);
    setSnack('Model added');
  }, []);

  const handleLoad = useCallback(async (model: ModelRecord) => {
    if (modelCtx.isGenerating) {
      setSnack('Stop generating before switching models');
      return;
    }
    setLoadingModelId(model.id);
    // No chat context here: use all-chats, model-file and this-model settings.
    const prepared = await prepareModel(model, null);
    await modelCtx.loadModel(prepared.model, prepared.load);
    setLoadingModelId(null);
  }, [modelCtx]);

  const handleRemove = useCallback(async () => {
    if (!deleteDialog) return;
    if (modelCtx.loadedModelId === deleteDialog.id) {
      await modelCtx.unload();
    }
    // Delete the file; a downloaded model owns its whole models/<id>/ folder
    // (split models have several parts there).
    if (Platform.OS !== 'web') {
      try {
        const { File } = await import('expo-file-system');
        if (!(canDownload && (await removeDownloadedModelFiles(deleteDialog.id)))) {
          const f = new File(deleteDialog.filePath);
          if (f.exists) f.delete();
        }
      } catch (e) {
        console.warn('Deleting the model file failed', e);
      }
    }
    await db.deleteModel(deleteDialog.id);
    setDeleteDialog(null);
    refresh();
    setSnack('Model removed');
  }, [deleteDialog, modelCtx, refresh, canDownload]);

  const handleTemplateChange = useCallback(async () => {
    if (!templateDialog) return;
    await db.updateModel(templateDialog.id, { templateOverride: templateChoice });
    setTemplateDialog(null);
    refresh();
  }, [templateDialog, templateChoice, refresh]);

  const handleRename = useCallback(async () => {
    if (!renameDialog || !renameText.trim()) return;
    await db.updateModel(renameDialog.id, { displayName: renameText.trim() });
    setRenameDialog(null);
    refresh();
  }, [renameDialog, renameText, refresh]);

  const totalSize = models.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0), 0);

  return (
    <>
      <Stack.Screen options={{
        title: 'Models',
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerRight: () => <IconButton icon="help-circle-outline" iconColor={c.text} onPress={() => router.push('/help')} />,
      }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        {isWeb && <WebNotice />}

        {/* Storage card */}
        <View style={[styles.storageCard, { backgroundColor: c.brandTint }]}>
          <Text style={{ color: c.brand, fontFamily: fontFamilies.mono, fontSize: 13 }}>
            Library: {models.length} model{models.length !== 1 ? 's' : ''} · {formatBytes(totalSize)} used
          </Text>
          {totalRam > 0 && (
            <Text style={{ color: c.brand, fontFamily: fontFamilies.mono, fontSize: 13 }}>
              Device RAM: {formatBytes(totalRam)}
            </Text>
          )}
        </View>

        {/* Add button */}
        <Button mode="contained" icon="plus" onPress={addModel} loading={importing} disabled={importing} style={{ borderRadius: radii.button }}>
          {importing ? importMsg : 'Add GGUF model'}
        </Button>
        {canDownload && (
          <Button mode="outlined" icon="download" onPress={() => router.push('/download')} style={{ borderRadius: radii.button }}>
            Download from Hugging Face
          </Button>
        )}

        {/* Hugging Face downloads in progress or failed */}
        {downloads.map((d) => {
          const { done, line } = downloadProgress(d, dlInfos);
          const failed = d.status === 'failed';
          return (
            <Card key={d.id} style={[styles.modelCard, { backgroundColor: c.surface, borderColor: failed ? c.error : c.hairline }]}>
              <Card.Content style={{ gap: 8 }}>
                <Text style={{ color: c.text, fontFamily: typeScale.title.fontFamily, fontSize: 16 }}>{d.label}</Text>
                <ProgressBar progress={d.totalBytes > 0 ? done / d.totalBytes : 0} color={failed ? c.error : c.brand} />
                <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.mono, fontSize: 12 }}>
                  {formatBytes(done)} of {formatBytes(d.totalBytes)}{d.parts.length > 1 ? ` · ${d.parts.length} parts` : ''}
                </Text>
                {line && <Text style={{ color: failed ? c.error : c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>{line}</Text>}
                <View style={[styles.actionRow, { justifyContent: 'flex-end', gap: 8 }]}>
                  {failed ? (
                    <>
                      <Button compact onPress={() => onCancelDownload(d)} textColor={c.error}>Remove</Button>
                      <Button compact mode="contained" onPress={() => onRetryDownload(d)}>Retry</Button>
                    </>
                  ) : (
                    <Button compact onPress={() => onCancelDownload(d)}>Cancel</Button>
                  )}
                </View>
              </Card.Content>
            </Card>
          );
        })}

        {/* Models list */}
        {models.length === 0 && !importing && downloads.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: c.brandTint }]}>
            <Text style={{ color: c.text, fontFamily: typeScale.title.fontFamily, fontSize: 16, textAlign: 'center' }}>No models yet</Text>
            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14, textAlign: 'center' }}>
              {canDownload ? 'Add a GGUF model file or download one from Hugging Face.' : 'Add a GGUF model file to get started.'}
            </Text>
          </View>
        )}

        {models.map((model) => {
          const isLoaded = modelCtx.loadedModelId === model.id;
          const isLoadingThis = loadingModelId === model.id;
          const hint = memoryHint(model.fileSizeBytes, totalRam);
          const hintColor = hint === 'fits' ? '#4CAF50' : hint === 'tight' ? c.accent : c.error;
          const hintLabel = hint === 'fits' ? 'Fits' : hint === 'tight' ? 'Tight' : 'Too large';

          return (
            <Card key={model.id} style={[styles.modelCard, { backgroundColor: c.surface, borderColor: c.hairline }]}>
              <Card.Content style={{ gap: 8 }}>
                <Text style={{ color: c.text, fontFamily: typeScale.title.fontFamily, fontSize: 16 }}>{model.displayName}</Text>
                <View style={styles.chipRow}>
                  {model.quantization && <Chip compact style={styles.metaChip} textStyle={[styles.metaChipText, { fontFamily: fontFamilies.mono, color: c.textSecondary }]}>{model.quantization}</Chip>}
                  {model.parameterLabel && <Chip compact style={styles.metaChip} textStyle={[styles.metaChipText, { fontFamily: fontFamilies.mono, color: c.textSecondary }]}>{model.parameterLabel}</Chip>}
                  <Chip compact style={styles.metaChip} textStyle={[styles.metaChipText, { fontFamily: fontFamilies.mono, color: c.textSecondary }]}>{formatBytes(model.fileSizeBytes)}</Chip>
                  {model.architecture && <Chip compact style={styles.metaChip} textStyle={[styles.metaChipText, { fontFamily: fontFamilies.mono, color: c.textSecondary }]}>{model.architecture}</Chip>}
                </View>
                <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>
                  Template: {model.templateOverride === 'auto'
                    ? model.detectedTemplate === 'auto-available' ? 'Auto (from file)' : 'Auto (ChatML fallback)'
                    : TEMPLATE_OPTIONS.find((t) => t.key === model.templateOverride)?.label ?? model.templateOverride}
                </Text>
                {totalRam > 0 && (
                  <Chip compact style={[styles.hintChip, { borderColor: hintColor }]} textStyle={{ color: hintColor, fontFamily: fontFamilies.mono, fontSize: 11 }}>{hintLabel}</Chip>
                )}
                <View style={styles.actionRow}>
                  {isLoaded ? (
                    <Chip icon="check" style={{ backgroundColor: c.brandTint }} textStyle={{ color: c.brand, fontFamily: fontFamilies.interMedium }}>Loaded</Chip>
                  ) : (
                    <Button mode="contained" onPress={() => handleLoad(model)} loading={isLoadingThis} disabled={isLoadingThis} compact>Load</Button>
                  )}
                  <Menu
                    visible={menuModel === model.id}
                    onDismiss={() => setMenuModel(null)}
                    anchor={<IconButton icon="dots-vertical" size={20} iconColor={c.textSecondary} onPress={() => setMenuModel(model.id)} />}
                  >
                    <Menu.Item title="Settings…" onPress={() => { setMenuModel(null); router.push({ pathname: '/settings/model', params: { modelId: model.id } }); }} leadingIcon="tune-variant" />
                    <Menu.Item title="Chat template…" onPress={() => { setMenuModel(null); setTemplateChoice(model.templateOverride as TemplateKey); setTemplateDialog(model); }} leadingIcon="code-tags" />
                    <Menu.Item title="Rename" onPress={() => { setMenuModel(null); setRenameText(model.displayName); setRenameDialog(model); }} leadingIcon="pencil-outline" />
                    <Menu.Item title="Remove" onPress={() => { setMenuModel(null); setDeleteDialog(model); }} leadingIcon="delete-outline" titleStyle={{ color: c.error }} />
                  </Menu>
                </View>
              </Card.Content>
            </Card>
          );
        })}
      </ScrollView>

      <Portal>
        {/* Template dialog */}
        <Dialog visible={!!templateDialog} onDismiss={() => setTemplateDialog(null)}>
          <Dialog.Title>Chat template</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 400 }}>
            <ScrollView>
              <RadioButton.Group onValueChange={(v) => setTemplateChoice(v as TemplateKey)} value={templateChoice}>
                {TEMPLATE_OPTIONS.map((t) => (
                  <RadioButton.Item key={t.key} label={t.label} value={t.key} />
                ))}
              </RadioButton.Group>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setTemplateDialog(null)}>Cancel</Button>
            <Button onPress={handleTemplateChange}>Save</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Rename dialog */}
        <Dialog visible={!!renameDialog} onDismiss={() => setRenameDialog(null)}>
          <Dialog.Title>Rename model</Dialog.Title>
          <Dialog.Content>
            <PaperInput value={renameText} onChangeText={setRenameText} mode="outlined" />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenameDialog(null)}>Cancel</Button>
            <Button onPress={handleRename}>Save</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Delete dialog */}
        <Dialog visible={!!deleteDialog} onDismiss={() => setDeleteDialog(null)}>
          <Dialog.Title>Remove model?</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: c.text }}>Remove model and delete its file from app storage?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteDialog(null)}>Cancel</Button>
            <Button onPress={handleRemove} textColor={c.error}>Remove</Button>
          </Dialog.Actions>
        </Dialog>
        {/* Offer to delete the picked original after a successful import */}
        <Dialog visible={!!originalPrompt} onDismiss={keepOriginal}>
          <Dialog.Title>Delete the original?</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text style={{ color: c.text }}>
              {originalPrompt?.name} is now in the app's own storage. The file you picked{originalPrompt?.size ? ` (${formatBytes(originalPrompt.size)})` : ''} is a separate copy the app doesn't need.
            </Text>
            <Text style={{ color: c.textSecondary }}>Deleting it frees the space. This can't be undone.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={keepOriginal}>Keep</Button>
            <Button onPress={deleteOriginal} textColor={c.error}>Delete</Button>
          </Dialog.Actions>
        </Dialog>
        {/* Format warning before import */}
        <Dialog visible={!!compatWarning} dismissable={false} dismissableBackButton={false}>
          <Dialog.Title>This model may not load</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text>
              {compatWarning?.types.length
                ? `${compatWarning.name} uses tensor formats the llama.cpp in this app can't load: ${compatWarning.types.join(', ')}.`
                : `${compatWarning?.name} looks like a PrismML ${parseQuantFromFilename(compatWarning?.name ?? '')} file.`}
            </Text>
            {compatWarning?.prism && (
              <Text>PQ2_0 and PTQ1_0 need PrismML's own llama.cpp fork. Download the Q2_0 version of the model instead; it has the same weights and runs on standard llama.cpp.</Text>
            )}
            <Text style={{ color: c.textSecondary }}>
              {compatWarning?.copied
                ? 'Loading it will most likely fail. Remove the copy to free the space?'
                : 'Importing copies the whole file, and loading it will most likely fail.'}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => answerCompat(true)}>{compatWarning?.copied ? 'Keep anyway' : 'Import anyway'}</Button>
            <Button onPress={() => answerCompat(false)}>{compatWarning?.copied ? 'Remove' : 'Cancel'}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={snack.length > 60 ? 5000 : 2000}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  storageCard: { padding: 16, borderRadius: radii.card, gap: 4 },
  emptyCard: { padding: 24, borderRadius: radii.card, alignItems: 'center', gap: 8 },
  modelCard: { borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip: { borderRadius: 8, height: 26 },
  metaChipText: { fontSize: 11 },
  hintChip: { alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1, backgroundColor: 'transparent' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
