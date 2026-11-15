import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text, SegmentedButtons, useTheme, Button, Menu, TextInput as PaperInput } from 'react-native-paper';
import { useRouter, Stack } from 'expo-router';
import Slider from '@react-native-community/slider';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies } from '@/constants/theme';
import { useSettings } from '@/contexts/SettingsContext';
import type { GenParams, ThemeMode, PromptPreset } from '@/types';
import { DEFAULT_GEN_PARAMS, PARAM_RANGES, PARAM_LABELS } from '@/types';
import * as db from '@/lib/db';

function ParamSlider({ label, value, range, onChange }: { label: string; value: number; range: { min: number; max: number; step: number }; onChange: (v: number) => void }) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
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

export default function SettingsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();
  const settings = useSettings();
  const isWeb = Platform.OS === 'web';

  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [presetMenu, setPresetMenu] = useState(false);
  const [promptText, setPromptText] = useState(settings.defaultSystemPrompt);

  React.useEffect(() => {
    if (isWeb) return;
    db.getAllPresets().then(setPresets).catch(() => {});
  }, [isWeb]);

  React.useEffect(() => {
    setPromptText(settings.defaultSystemPrompt);
  }, [settings.defaultSystemPrompt]);

  const updateParam = (key: keyof GenParams, value: number) => {
    settings.setDefaultParams({ ...settings.defaultParams, [key]: value });
  };

  const resetParams = () => {
    settings.setDefaultParams({ ...DEFAULT_GEN_PARAMS });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 40 }}>

        {/* Appearance */}
        <Text style={[styles.section, { color: c.text, fontFamily: fontFamilies.interSemiBold }]}>Appearance</Text>
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
        <Text style={[styles.section, { color: c.text, fontFamily: fontFamilies.interSemiBold, marginTop: spacing.md }]}>Default system prompt</Text>
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

        {/* Default parameters */}
        <Text style={[styles.section, { color: c.text, fontFamily: fontFamilies.interSemiBold, marginTop: spacing.md }]}>Default generation parameters</Text>
        {(Object.keys(PARAM_RANGES) as (keyof GenParams)[]).map((key) => (
          <ParamSlider
            key={key}
            label={PARAM_LABELS[key]}
            value={settings.defaultParams[key]}
            range={PARAM_RANGES[key]}
            onChange={(v) => updateParam(key, v)}
          />
        ))}
        <Button mode="text" onPress={resetParams} textColor={c.brand}>Reset to defaults</Button>

        {/* About */}
        <Text style={[styles.section, { color: c.text, fontFamily: fontFamilies.interSemiBold, marginTop: spacing.md }]}>About</Text>
        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14 }}>Local Chat v1.0.0</Text>
        <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>All data stays on this device.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, lineHeight: 22 },
});
