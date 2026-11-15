import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, ScrollView, Alert } from 'react-native';
import { Text, Button, useTheme, Card, Chip, IconButton, Menu, Dialog, Portal, TextInput as PaperInput, ActivityIndicator, RadioButton, Snackbar } from 'react-native-paper';
import { useRouter, Stack } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, radii, fontFamilies, typeScale } from '@/constants/theme';
import { useModelContext } from '@/contexts/ModelContext';
import * as db from '@/lib/db';
import { parseQuantFromFilename, formatBytes, memoryHint } from '@/lib/gguf';
import * as llama from '@/lib/llama';
import type { ModelRecord, TemplateKey } from '@/types';
import { TEMPLATE_OPTIONS } from '@/types';
import WebNotice from '@/components/WebNotice';

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
  const [snack, setSnack] = useState('');
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (isWeb) return;
    const m = await db.getAllModels();
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
      setImportMsg(`Importing ${name}… keep the app open`);

      const { Paths, File, Directory } = await import('expo-file-system');
      const modelsDir = new Directory(Paths.document, 'models');
      if (!modelsDir.exists) {
        modelsDir.create();
      }
      const id = db.generateId();
      const destFileName = `${id}-${name}`;
      const dest = new File(modelsDir, destFileName);

      // Copy file
      const sourceFile = new File(asset.uri);
      copiedFile = dest;
      await sourceFile.copy(dest);

      const fileSize = asset.size || dest.size || 0;

      // Read metadata
      let displayName = name.replace(/\.gguf$/i, '');
      let architecture: string | null = null;
      let parameterLabel: string | null = null;
      let detectedTemplate: string | null = null;
      let trainedContext: number | null = null;

      try {
        const info = await llama.loadModelInfo(dest.uri);
        if (info) {
          displayName = (info as any)?.['general.name'] ?? displayName;
          architecture = (info as any)?.['general.architecture'] ?? null;
          parameterLabel = (info as any)?.['general.size_label'] ?? null;
          if ((info as any)?.['tokenizer.chat_template']) detectedTemplate = 'auto-available';
          const arch = architecture?.toLowerCase?.() ?? '';
          trainedContext = (info as any)?.[`${arch}.context_length`] ?? null;
        }
      } catch (e) {
        console.warn('Metadata read failed', e);
        // Don't block import; metadata is optional enhancement
      }

      const quant = parseQuantFromFilename(name);

      const model: ModelRecord = {
        id,
        displayName,
        fileName: name,
        filePath: dest.uri,
        fileSizeBytes: fileSize,
        quantization: quant,
        architecture,
        parameterLabel,
        detectedTemplate,
        templateOverride: 'auto',
        trainedContext,
        addedAt: Date.now(),
      };
      await db.insertModel(model);
      copiedFile = null; // owned by the model record now
      setImporting(false);
      setImportMsg('');
      refresh();
      setSnack('Model added');
    } catch (e) {
      try { if (copiedFile?.exists) copiedFile.delete(); } catch {}
      setImporting(false);
      setImportMsg('');
      setSnack('Import failed: ' + String((e as any)?.message ?? e));
    }
  }, [isWeb, refresh]);

  const handleLoad = useCallback(async (model: ModelRecord) => {
    if (modelCtx.isGenerating) {
      setSnack('Stop generating before switching models');
      return;
    }
    setLoadingModelId(model.id);
    const params = await db.getDefaultParams();
    await modelCtx.loadModel(model, { contextLength: params.contextLength, threads: params.threads });
    setLoadingModelId(null);
  }, [modelCtx]);

  const handleRemove = useCallback(async () => {
    if (!deleteDialog) return;
    if (modelCtx.loadedModelId === deleteDialog.id) {
      await modelCtx.unload();
    }
    // Delete file
    if (Platform.OS !== 'web') {
      try {
        const { File } = await import('expo-file-system');
        const f = new File(deleteDialog.filePath);
        if (f.exists) f.delete();
      } catch {}
    }
    await db.deleteModel(deleteDialog.id);
    setDeleteDialog(null);
    refresh();
    setSnack('Model removed');
  }, [deleteDialog, modelCtx, refresh]);

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

        {/* Models list */}
        {models.length === 0 && !importing && (
          <View style={[styles.emptyCard, { backgroundColor: c.brandTint }]}>
            <Text style={{ color: c.text, fontFamily: typeScale.title.fontFamily, fontSize: 16, textAlign: 'center' }}>No models yet</Text>
            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14, textAlign: 'center' }}>
              Add a GGUF model file to get started.
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
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2000}>{snack}</Snackbar>
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
