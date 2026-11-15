import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, ScrollView } from 'react-native';
import { Text, Switch, useTheme, Button, Menu, TextInput as PaperInput, Dialog, Portal, Snackbar } from 'react-native-paper';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import Slider from '@react-native-community/slider';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies } from '@/constants/theme';
import { useSettings } from '@/contexts/SettingsContext';
import * as db from '@/lib/db';
import type { SessionRecord, GenParams, PromptPreset } from '@/types';
import { DEFAULT_GEN_PARAMS, PARAM_RANGES, PARAM_LABELS } from '@/types';

function ParamSlider({ label, value, range, onChange, mono }: { label: string; value: number; range: { min: number; max: number; step: number }; onChange: (v: number) => void; mono: boolean }) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  return (
    <View style={paramStyles.row}>
      <View style={paramStyles.labelRow}>
        <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 14 }}>{label}</Text>
        <Text style={{ color: c.text, fontFamily: fontFamilies.mono, fontSize: 13 }}>
          {range.step < 1 ? value.toFixed(2) : String(value)}
        </Text>
      </View>
      <Slider
        value={value}
        minimumValue={range.min}
        maximumValue={range.max}
        step={range.step}
        onValueChange={onChange}
        minimumTrackTintColor={c.brand}
        maximumTrackTintColor={c.hairline}
        thumbTintColor={c.brand}
        style={{ height: 40 }}
      />
    </View>
  );
}

const paramStyles = StyleSheet.create({
  row: { marginBottom: 12 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
});

export default function ChatSettingsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const { sessionId = '' } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const settings = useSettings();
  const isWeb = Platform.OS === 'web';

  const [session, setSession] = useState<SessionRecord | null>(null);
  const [useDefaultPrompt, setUseDefaultPrompt] = useState(true);
  const [promptText, setPromptText] = useState('');
  const [useDefaultParams, setUseDefaultParams] = useState(true);
  const [params, setParams] = useState<GenParams>({ ...DEFAULT_GEN_PARAMS });
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [presetMenu, setPresetMenu] = useState(false);
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
      setUseDefaultPrompt(s.systemPromptOverride == null);
      setPromptText(s.systemPromptOverride ?? settings.defaultSystemPrompt);
      const hasOverride = s.paramsOverride != null;
      setUseDefaultParams(!hasOverride);
      if (hasOverride) {
        try { setParams({ ...DEFAULT_GEN_PARAMS, ...JSON.parse(s.paramsOverride!) }); } catch {}
      } else {
        setParams({ ...settings.defaultParams });
      }
      const p = await db.getAllPresets();
      setPresets(p);
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

  const toggleDefaultPrompt = (val: boolean) => {
    setUseDefaultPrompt(val);
    if (val) {
      autoSave({ systemPromptOverride: null });
    } else {
      autoSave({ systemPromptOverride: promptText });
    }
  };

  const updatePrompt = (text: string) => {
    setPromptText(text);
    if (!useDefaultPrompt) {
      autoSave({ systemPromptOverride: text });
    }
  };

  const toggleDefaultParams = (val: boolean) => {
    setUseDefaultParams(val);
    if (val) {
      autoSave({ paramsOverride: null });
    } else {
      autoSave({ paramsOverride: JSON.stringify(params) });
    }
  };

  const updateParam = (key: keyof GenParams, value: number) => {
    const next = { ...params, [key]: value };
    setParams(next);
    if (!useDefaultParams) {
      autoSave({ paramsOverride: JSON.stringify(next) });
    }
  };

  const resetParams = () => {
    setParams({ ...settings.defaultParams });
    autoSave({ paramsOverride: JSON.stringify(settings.defaultParams) });
  };

  const savePreset = async () => {
    if (!saveName.trim()) { setSaveError('Name is required'); return; }
    const exists = await db.presetNameExists(saveName.trim());
    if (exists) { setSaveError('A preset with this name already exists'); return; }
    await db.insertPreset({ id: db.generateId(), name: saveName.trim(), content: promptText, createdAt: Date.now() });
    setSaveDialog(false);
    setSaveName('');
    setSaveError('');
    setSnack('Preset saved');
    const p = await db.getAllPresets();
    setPresets(p);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Chat settings', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        {/* System prompt */}
        <Text style={[styles.sectionTitle, { color: c.text, fontFamily: fontFamilies.interSemiBold }]}>System prompt</Text>
        <View style={styles.switchRow}>
          <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 15, flex: 1 }}>Use default system prompt</Text>
          <Switch value={useDefaultPrompt} onValueChange={toggleDefaultPrompt} color={c.brand} />
        </View>
        {!useDefaultPrompt && (
          <>
            <PaperInput
              value={promptText}
              onChangeText={updatePrompt}
              mode="outlined"
              multiline
              numberOfLines={5}
              style={{ backgroundColor: c.surfaceRaised }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Menu
                visible={presetMenu}
                onDismiss={() => setPresetMenu(false)}
                anchor={<Button mode="outlined" onPress={() => setPresetMenu(true)} compact>Load preset</Button>}
              >
                {presets.map((p) => (
                  <Menu.Item key={p.id} title={p.name} onPress={() => { setPromptText(p.content); setPresetMenu(false); autoSave({ systemPromptOverride: p.content }); }} />
                ))}
                {presets.length === 0 && <Menu.Item title="No presets yet" disabled />}
              </Menu>
              <Button mode="outlined" onPress={() => setSaveDialog(true)} compact>Save as preset</Button>
            </View>
          </>
        )}

        {/* Parameters */}
        <Text style={[styles.sectionTitle, { color: c.text, fontFamily: fontFamilies.interSemiBold, marginTop: spacing.md }]}>Parameters</Text>
        <View style={styles.switchRow}>
          <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 15, flex: 1 }}>Use global defaults</Text>
          <Switch value={useDefaultParams} onValueChange={toggleDefaultParams} color={c.brand} />
        </View>
        {!useDefaultParams && (
          <>
            {(Object.keys(PARAM_RANGES) as (keyof GenParams)[]).map((key) => (
              <ParamSlider
                key={key}
                label={PARAM_LABELS[key]}
                value={params[key]}
                range={PARAM_RANGES[key]}
                onChange={(v) => updateParam(key, v)}
                mono={false}
              />
            ))}
            <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 12 }}>
              Changing context length or threads reloads the model on next message.
            </Text>
            <Button mode="text" onPress={resetParams} textColor={c.brand}>Reset to defaults</Button>
          </>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={saveDialog} onDismiss={() => setSaveDialog(false)}>
          <Dialog.Title>Save as preset</Dialog.Title>
          <Dialog.Content>
            <PaperInput value={saveName} onChangeText={(t) => { setSaveName(t); setSaveError(''); }} mode="outlined" label="Preset name" error={!!saveError} />
            {!!saveError && <Text style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{saveError}</Text>}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSaveDialog(false)}>Cancel</Button>
            <Button onPress={savePreset}>Save</Button>
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
