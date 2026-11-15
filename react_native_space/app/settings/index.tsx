import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, Pressable } from 'react-native';
import { Text, SegmentedButtons, useTheme, Button, Menu, TextInput as PaperInput, Icon } from 'react-native-paper';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, radii } from '@/constants/theme';
import { useSettings } from '@/contexts/SettingsContext';
import type { ModelRecord, ThemeMode, PromptPreset } from '@/types';
import * as db from '@/lib/db';
import ParamEditor from '@/components/params/ParamEditor';
import { parseParamSet, resolveParams, type ParamSet } from '@/lib/params';

export default function SettingsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();
  const settings = useSettings();
  const isWeb = Platform.OS === 'web';

  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [presetMenu, setPresetMenu] = useState(false);
  const [promptText, setPromptText] = useState(settings.defaultSystemPrompt);
  const [globalParams, setGlobalParams] = useState<ParamSet>({});
  const [models, setModels] = useState<ModelRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (isWeb) return;
      db.getAllPresets().then(setPresets).catch(() => {});
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

        {/* Default system prompt */}
        <Text style={[styles.section, { color: c.text, marginTop: spacing.md }]}>System prompt</Text>
        <Text style={[styles.note, { color: c.textSecondary }]}>Used by every chat unless the chat sets its own.</Text>
        <PaperInput
          value={promptText}
          onChangeText={(t) => { setPromptText(t); settings.setDefaultSystemPrompt(t); }}
          mode="outlined"
          multiline
          numberOfLines={4}
          style={{ backgroundColor: c.surfaceRaised }}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Menu
            visible={presetMenu}
            onDismiss={() => setPresetMenu(false)}
            anchor={<Button mode="outlined" onPress={() => setPresetMenu(true)} compact>Load preset</Button>}
          >
            {presets.map((p) => (
              <Menu.Item key={p.id} title={p.name} onPress={() => { setPromptText(p.content); settings.setDefaultSystemPrompt(p.content); setPresetMenu(false); }} />
            ))}
            {presets.length === 0 && <Menu.Item title="No presets yet" disabled />}
          </Menu>
          <Button mode="outlined" onPress={() => router.push('/settings/presets')} compact>Manage presets</Button>
        </View>

        {/* llama.cpp settings for all chats */}
        <Text style={[styles.section, { color: c.text, marginTop: spacing.md }]}>Model settings for all chats</Text>
        <Text style={[styles.note, { color: c.textSecondary }]}>
          llama.cpp settings used everywhere. A model's own settings (below) and a chat's settings take priority.
        </Text>
        <ParamEditor overrides={globalParams} inherited={resolveParams({})} onChange={updateGlobal} />

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
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.interSemiBold },
  note: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.inter, marginTop: -8 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
});
