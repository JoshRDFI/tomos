import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, Pressable } from 'react-native';
import { Text, SegmentedButtons, useTheme, Button, Menu, TextInput as PaperInput, Icon, Switch, Dialog, Portal, Snackbar } from 'react-native-paper';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import PersonaPicker, { personaChoiceLabel } from '@/components/chat/PersonaPicker';
import { importPersonaFromFile } from '@/lib/personaImport';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, radii } from '@/constants/theme';
import { useSettings } from '@/contexts/SettingsContext';
import { useModelContext } from '@/contexts/ModelContext';
import type { ModelRecord, ThemeMode, Persona } from '@/types';
import * as db from '@/lib/db';
import ParamEditor from '@/components/params/ParamEditor';
import { appDefaultsFor, parseParamSet, resolveParams, type ParamSet } from '@/lib/params';
import { defaultThreads } from '@/lib/device';
import { dateSentence } from '@/lib/dateContext';
import { BackupError, backupFileName, parseBackup, summarize, type Backup } from '@/lib/backup';

export default function SettingsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();
  const settings = useSettings();
  const { isGenerating } = useModelContext();
  const isWeb = Platform.OS === 'web';

  const [presets, setPresets] = useState<Persona[]>([]);
  const [defaultPersonaId, setDefaultPersonaId] = useState<string | null>(null);
  const [promptText, setPromptText] = useState(settings.defaultSystemPrompt);
  const [globalParams, setGlobalParams] = useState<ParamSet>({});
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [snack, setSnack] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<Backup | null>(null);

  const defaultChoice: db.PersonaChoice = defaultPersonaId && presets.some((p) => p.id === defaultPersonaId) ? { kind: 'persona', id: defaultPersonaId } : { kind: 'none' };

  const handleBackup = useCallback(async () => {
    setBackupBusy(true);
    try {
      const backup = await db.exportBackup();
      const { Paths, File } = await import('expo-file-system');
      const file = new File(Paths.cache, backupFileName(new Date()));
      if (file.exists) file.delete();
      file.write(JSON.stringify(backup));
      const Sharing = await import('expo-sharing');
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save backup' });
    } catch (e) {
      setSnack('Backup failed: ' + String((e as any)?.message ?? e));
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const handlePickRestore = useCallback(async () => {
    try {
      const DocPicker = await import('expo-document-picker');
      const result = await DocPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
      if (result.canceled || !result.assets?.[0]) return;
      setBackupBusy(true);
      // Copy out of the content:// URI, then read it.
      const { copyAsync } = await import('expo-file-system/legacy');
      const { Paths, File } = await import('expo-file-system');
      const tmp = new File(Paths.cache, 'restore.json');
      if (tmp.exists) tmp.delete();
      await copyAsync({ from: result.assets[0].uri, to: tmp.uri });
      const text = await tmp.text();
      tmp.delete();
      setRestoreCandidate(parseBackup(text));
    } catch (e) {
      setSnack(e instanceof BackupError ? e.message : 'Couldn\'t read that file: ' + String((e as any)?.message ?? e));
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    const backup = restoreCandidate;
    setRestoreCandidate(null);
    if (!backup) return;
    if (isGenerating) {
      setSnack('Stop generating before restoring a backup');
      return;
    }
    setBackupBusy(true);
    try {
      await db.restoreBackup(backup);
      await settings.reload();
      setGlobalParams(await db.getGlobalParams());
      setPresets(await db.getAllPersonas());
      setDefaultPersonaId((await db.getSetting('defaultPersonaId')) || null);
      setModels(await db.getAllModels());
      setSnack('Backup restored');
    } catch (e) {
      setSnack('Restore failed; nothing was changed. ' + String((e as any)?.message ?? e));
    } finally {
      setBackupBusy(false);
    }
  }, [restoreCandidate, settings, isGenerating]);

  useFocusEffect(
    useCallback(() => {
      if (isWeb) return;
      db.getAllPersonas().then(setPresets).catch(() => {});
      db.getSetting('defaultPersonaId').then((v) => setDefaultPersonaId(v || null)).catch(() => {});
      db.getAllModels().then(setModels).catch(() => {});
    }, [isWeb]),
  );

  useEffect(() => {
    if (isWeb) return;
    db.getGlobalParams().then(setGlobalParams).catch(() => {});
  }, [isWeb]);

  useEffect(() => {
    setPromptText(settings.defaultSystemPrompt);
  }, [settings.defaultSystemPrompt]);

  // Debounced save of the all-chats settings, flushed when leaving.
  const pending = useRef<ParamSet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) {
      db.setGlobalParams(pending.current).catch(() => {});
      pending.current = null;
    }
  }, []);
  useEffect(() => flush, [flush]);
  const updateGlobal = (next: ParamSet) => {
    setGlobalParams(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Appearance */}
        <Text style={[styles.section, { color: c.text }]}>Appearance</Text>
        <SegmentedButtons
          value={settings.themeMode}
          onValueChange={(v) => settings.setThemeMode(v as ThemeMode)}
          buttons={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />

        {/* What new chats start with */}
        <Text style={[styles.section, { color: c.text, marginTop: spacing.md }]}>New chats use</Text>
        <Text style={[styles.note, { color: c.textSecondary }]}>Applies to chats you start from now on; each chat can change it in its own settings.</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <PersonaPicker
            value={defaultChoice}
            personas={presets}
            allowCustom={false}
            onChange={(choice) => {
              const v = choice.kind === 'persona' ? choice.id : null;
              setDefaultPersonaId(v);
              db.setSetting('defaultPersonaId', v ?? '').catch(() => {});
            }}
            onImport={async () => {
              // The imported persona becomes the one new chats use.
              const r = await importPersonaFromFile();
              if (!r) return;
              if ('error' in r) { setSnack(r.error); return; }
              setPresets(await db.getAllPersonas());
              setDefaultPersonaId(r.persona.id);
              await db.setSetting('defaultPersonaId', r.persona.id);
              setSnack(`Imported ${r.persona.name}; new chats use it`);
            }}
            anchor={(open) => (
              <Button mode="outlined" onPress={open} icon="account-voice" compact>{personaChoiceLabel(defaultChoice, presets, 'No persona (default system prompt)')}</Button>
            )}
          />
          <Button mode="outlined" onPress={() => router.push('/settings/personas')} compact>Manage personas</Button>
        </View>
        {defaultChoice.kind === 'none' && (
          <>
            <Text style={[styles.note, { color: c.textSecondary, marginTop: spacing.sm }]}>Default system prompt, used by chats with no persona and no text of their own:</Text>
            <PaperInput
              value={promptText}
              onChangeText={(t) => { setPromptText(t); settings.setDefaultSystemPrompt(t); }}
              mode="outlined"
              multiline
              numberOfLines={4}
              style={{ backgroundColor: c.surfaceRaised }}
            />
          </>
        )}
        <View style={[styles.switchRow, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>Tell the model today's date</Text>
            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 12 }}>
              Adds “{dateSentence(new Date())}” to the system prompt.
            </Text>
          </View>
          <Switch value={settings.includeDate} onValueChange={settings.setIncludeDate} accessibilityLabel="Tell the model today's date" />
        </View>

        {/* llama.cpp settings for all chats */}
        <Text style={[styles.section, { color: c.text, marginTop: spacing.md }]}>Model settings for all chats</Text>
        <Text style={[styles.note, { color: c.textSecondary }]}>
          llama.cpp settings used everywhere. A model's own settings (below) and a chat's settings take priority.
        </Text>
        <ParamEditor overrides={globalParams} inherited={resolveParams({ app: appDefaultsFor(null, defaultThreads()) })} onChange={updateGlobal} />

        {/* Per-model */}
        <Text style={[styles.section, { color: c.text, marginTop: spacing.md }]}>Settings per model</Text>
        <Text style={[styles.note, { color: c.textSecondary }]}>
          Recommended settings in a model file are applied automatically; tap a model to see or change them.
        </Text>
        {models.length === 0 && (
          <Button mode="outlined" icon="chip" onPress={() => router.push('/models')} style={{ alignSelf: 'flex-start' }}>Add a model</Button>
        )}
        {models.map((m) => {
          const own = Object.keys(parseParamSet(m.paramsOverride)).length;
          const file = Object.keys(parseParamSet(m.fileParams)).length;
          const summary = [
            file ? `${file} from model file` : null,
            own ? `${own} customized` : null,
          ].filter(Boolean).join(' · ') || 'Using settings for all chats';
          return (
            <Pressable
              key={m.id}
              onPress={() => router.push({ pathname: '/settings/model', params: { modelId: m.id } })}
              style={[styles.navRow, { backgroundColor: c.surface, borderColor: c.hairline }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>{m.displayName}</Text>
                <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 12 }}>{summary}</Text>
              </View>
              <Icon source="chevron-right" size={20} color={c.textSecondary} />
            </Pressable>
          );
        })}

        {/* Backup */}
        <Text style={[styles.section, { color: c.text, marginTop: spacing.md }]}>Backup</Text>
        <Text style={[styles.note, { color: c.textSecondary }]}>
          All chats (with every version), personas and settings, as one JSON file. Model files aren't included; settings for models you've also imported here are restored onto them.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button mode="outlined" icon="export" onPress={handleBackup} disabled={backupBusy || isWeb} compact>Back up</Button>
          <Button mode="outlined" icon="import" onPress={handlePickRestore} disabled={backupBusy || isWeb || isGenerating} compact>Restore…</Button>
        </View>

        {/* About */}
        <Pressable
          onPress={() => router.push('/settings/about')}
          style={[styles.navRow, { backgroundColor: c.surface, borderColor: c.hairline, marginTop: spacing.md }]}
        >
          <Icon source="information-outline" size={20} color={c.textSecondary} />
          <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15, flex: 1 }}>About & licenses</Text>
          <Icon source="chevron-right" size={20} color={c.textSecondary} />
        </Pressable>
      </ScrollView>

      <Portal>
        <Dialog visible={!!restoreCandidate} onDismiss={() => setRestoreCandidate(null)}>
          <Dialog.Title>Replace everything with this backup?</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Text>{restoreCandidate ? summarize(restoreCandidate) : ''}.</Text>
            <Text style={{ color: c.textSecondary }}>
              Your current chats, personas and settings will be replaced. This can't be undone; back up first if you might want them.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRestoreCandidate(null)}>Cancel</Button>
            <Button onPress={handleRestore} textColor={c.error}>Replace</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.interSemiBold },
  note: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.inter, marginTop: -8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
});
