import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, ScrollView } from 'react-native';
import { Text, useTheme, Button, TextInput as PaperInput, Dialog, Portal, Snackbar, Switch } from 'react-native-paper';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { blankPersona, completionParamsOnly } from '@/lib/personas';
import PersonaPicker, { personaChoiceLabel } from '@/components/chat/PersonaPicker';
import { spacing, fontFamilies } from '@/constants/theme';
import { useSettings } from '@/contexts/SettingsContext';
import * as db from '@/lib/db';
import type { SessionRecord, Persona } from '@/types';
import ParamEditor from '@/components/params/ParamEditor';
import { importPersonaFromFile } from '@/lib/personaImport';
import { ensureFileParams } from '@/lib/modelMeta';
import { appDefaultsFor, parseParamSet, resolveParams, serializeParamSet, thinkingEnabled, type ParamSet, type ResolvedParams } from '@/lib/params';

export default function ChatSettingsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const settings = useSettings();
  const isWeb = Platform.OS === 'web';

  const [session, setSession] = useState<SessionRecord | null>(null);
  const [choice, setChoice] = useState<db.PersonaChoice>({ kind: 'none' });
  const [baseLayers, setBaseLayers] = useState<{ app?: ParamSet; global: ParamSet; file: ParamSet; model: ParamSet }>({ global: {}, file: {}, model: {} });
  const [promptText, setPromptText] = useState('');
  const [overrides, setOverrides] = useState<ParamSet>({});
  const [inherited, setInherited] = useState<ResolvedParams>(() => resolveParams({}));
  const [modelName, setModelName] = useState<string | null>(null);
  const [presets, setPresets] = useState<Persona[]>([]);
  const [saveDialog, setSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [snack, setSnack] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isWeb || !sessionId) return;
    (async () => {
      const s = await db.getSession(sessionId);
      if (!s) return;
      setSession(s);
      setChoice(db.personaChoiceOf(s));
      setPromptText(s.systemPromptOverride ?? settings.defaultSystemPrompt);
      setOverrides(parseParamSet(s.paramsOverride));
      // Inherited: all chats < model file < this model, for the chat's model.
      const modelId = s.modelId ?? (await db.getSetting('lastModelId'));
      let model = modelId ? await db.getModel(modelId) : null;
      if (model) model = await ensureFileParams(model);
      setModelName(model?.displayName ?? null);
      const layers = { app: appDefaultsFor(model?.trainedContext), global: await db.getGlobalParams(), file: parseParamSet(model?.fileParams), model: parseParamSet(model?.paramsOverride) };
      setBaseLayers(layers);
      const p = await db.getAllPersonas();
      setPresets(p);
      const chosen = s.systemPromptOverride == null && s.personaId ? p.find((x) => x.id === s.personaId) : undefined;
      setInherited(resolveParams({ ...layers, persona: chosen ? completionParamsOnly(chosen.params) : undefined }));
    })();
  }, [isWeb, sessionId]);

  // Debounced save. Pending fields are merged, so a quick prompt change
  // followed by a slider move saves both instead of only the last one.
  const pending = useRef<Partial<SessionRecord>>({});

  const flush = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const fields = pending.current;
    pending.current = {};
    if (!sessionId || Object.keys(fields).length === 0) return;
    db.updateSession(sessionId, { ...fields, updatedAt: Date.now() }).catch(() => {});
  }, [sessionId]);

  const autoSave = useCallback((fields: Partial<SessionRecord>) => {
    if (!sessionId) return;
    pending.current = { ...pending.current, ...fields };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 300);
  }, [sessionId, flush]);

  // Save immediately when leaving the screen.
  useEffect(() => flush, [flush]);

  // Inherited settings include the chosen persona's.
  const applyChoice = useCallback((next: db.PersonaChoice, list: Persona[] = presets) => {
    setChoice(next);
    const persona = next.kind === 'persona' ? list.find((x) => x.id === next.id) : undefined;
    setInherited(resolveParams({ ...baseLayers, persona: persona ? completionParamsOnly(persona.params) : undefined }));
  }, [presets, baseLayers]);

  const changeChoice = async (next: db.PersonaChoice) => {
    flush();
    const resolved: db.PersonaChoice = next.kind === 'custom' ? { kind: 'custom', text: promptText } : next;
    applyChoice(resolved);
    if (sessionId) await db.setSessionPersona(sessionId, resolved);
  };

  const updatePrompt = (text: string) => {
    setPromptText(text);
    if (choice.kind === 'custom') {
      setChoice({ kind: 'custom', text });
      autoSave({ systemPromptOverride: text });
    }
  };

  const updateOverrides = (next: ParamSet) => {
    setOverrides(next);
    autoSave({ paramsOverride: serializeParamSet(next) });
  };

  // "Save as persona": the custom text becomes a persona, and this chat uses it.
  const savePersona = async () => {
    const n = saveName.trim();
    if (!n) { setSaveError('Name is required'); return; }
    if (await db.personaNameExists(n)) { setSaveError('A persona with this name already exists'); return; }
    const persona = blankPersona({ id: db.generateId(), name: n, content: promptText, createdAt: Date.now() });
    await db.insertPersona(persona);
    setSaveDialog(false);
    setSaveName('');
    setSaveError('');
    const list = await db.getAllPersonas();
    setPresets(list);
    flush();
    const next: db.PersonaChoice = { kind: 'persona', id: persona.id };
    applyChoice(next, list);
    if (sessionId) await db.setSessionPersona(sessionId, next);
    setSnack(`Saved as persona "${n}"`);
  };

  // "Import from file…": this chat uses the imported persona.
  const importPersona = async () => {
    const r = await importPersonaFromFile();
    if (!r) return;
    if ('error' in r) { setSnack(r.error); return; }
    const list = await db.getAllPersonas();
    setPresets(list);
    flush();
    const next: db.PersonaChoice = { kind: 'persona', id: r.persona.id };
    applyChoice(next, list);
    if (sessionId) await db.setSessionPersona(sessionId, next);
    setSnack(`Imported ${r.persona.name}`);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Chat settings', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        {/* System prompt */}
        <Text style={[styles.sectionTitle, { color: c.text, fontFamily: fontFamilies.interSemiBold }]}>Instructions</Text>
        <View style={styles.switchRow}>
          <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 15, flex: 1 }}>Persona</Text>
          <PersonaPicker
            value={choice}
            personas={presets}
            allowCustom
            onChange={changeChoice}
            onImport={importPersona}
            anchor={(open) => (
              <Button mode="outlined" onPress={open} icon="account-voice" compact>{personaChoiceLabel(choice, presets, 'No persona')}</Button>
            )}
          />
        </View>
        {choice.kind === 'none' && (
          <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>Uses the default system prompt from Settings.</Text>
        )}
        {choice.kind === 'custom' && (
          <>
            <PaperInput
              value={promptText}
              onChangeText={updatePrompt}
              mode="outlined"
              multiline
              numberOfLines={5}
              style={{ backgroundColor: c.surfaceRaised }}
            />
            <Button mode="outlined" onPress={() => setSaveDialog(true)} compact style={{ alignSelf: 'flex-start' }}>Save as persona</Button>
          </>
        )}

        {/* Same per-chat setting as the Thinking row under "Settings for this chat". */}
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 15 }}>Thinking</Text>
            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>
              For models that think before answering (Qwen3, DeepSeek-R1…). Off gives faster, shorter replies.
            </Text>
          </View>
          <Switch
            value={thinkingEnabled(overrides, inherited)}
            onValueChange={(on) => updateOverrides({ ...overrides, enable_thinking: on })}
            accessibilityLabel="Thinking"
          />
        </View>

        <Button
          mode="outlined"
          icon="arrow-right-bold-box-outline"
          onPress={() => router.navigate({ pathname: '/', params: { continueFrom: sessionId } })}
          style={{ alignSelf: 'flex-start', marginTop: spacing.sm }}
        >
          Continue in a new chat
        </Button>
        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>
          Starts a new chat with a summary of this one and your last exchange, the same persona and settings, and a link back.
        </Text>

        {/* llama.cpp settings */}
        <Text style={[styles.sectionTitle, { color: c.text, fontFamily: fontFamilies.interSemiBold, marginTop: spacing.md }]}>Settings for this chat</Text>
        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>
          Override settings for this chat only. Everything else comes from Settings{modelName ? ` and ${modelName}` : ''}.
        </Text>
        <ParamEditor overrides={overrides} inherited={inherited} onChange={updateOverrides} />
      </ScrollView>

      <Portal>
        <Dialog visible={saveDialog} onDismiss={() => setSaveDialog(false)}>
          <Dialog.Title>Save as persona</Dialog.Title>
          <Dialog.Content>
            <PaperInput value={saveName} onChangeText={(t) => { setSaveName(t); setSaveError(''); }} mode="outlined" label="Persona name" error={!!saveError} />
            {!!saveError && <Text style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{saveError}</Text>}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSaveDialog(false)}>Cancel</Button>
            <Button onPress={savePersona}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2000}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
});
