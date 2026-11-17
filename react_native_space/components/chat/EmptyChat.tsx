import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Button, Icon, useTheme, Chip } from 'react-native-paper';
import { useRouter } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, radii, typeScale, fontFamilies } from '@/constants/theme';
import type { ModelRecord } from '@/types';

// Sentence starters: tapping one puts it in the message box to finish.
const SUGGESTIONS = [
  { label: 'Explain a concept simply', text: 'Explain simply: ' },
  { label: 'Summarize this text…', text: 'Summarize this text:\n' },
  { label: 'Write a Python function that…', text: 'Write a Python function that ' },
  { label: 'Brainstorm ideas for…', text: 'Brainstorm ideas for ' },
];

interface Props {
  hasModels: boolean;
  loadedModel: ModelRecord | null;
  hasModelInLib: boolean; // at least one model in library, even if not loaded
  onSuggestion: (s: string) => void;
  onOpenModelMenu: () => void;
}

export default function EmptyChat({ hasModels, loadedModel, hasModelInLib, onSuggestion, onOpenModelMenu }: Props) {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();

  // No models at all
  if (!hasModels) {
    return (
      <View style={styles.center}>
        <View style={[styles.focalCard, { backgroundColor: c.brandTint }]}>
          <Icon source="chip" size={40} color={c.brand} />
          <Text style={[styles.focalTitle, { color: c.text, fontFamily: typeScale.title.fontFamily }]}>Run models on your phone</Text>
          <Text style={[styles.focalBody, { color: c.textSecondary, fontFamily: fontFamilies.inter }]}>
            Add a GGUF model file (e.g. Q4_K_M, 3B–8B) to start chatting offline.
          </Text>
          <Button mode="contained" onPress={() => router.push('/models')} style={styles.focalBtn} labelStyle={{ fontFamily: fontFamilies.interMedium }}>
            Add a model
          </Button>
          <Button mode="text" onPress={() => router.push('/help')} textColor={c.brand} labelStyle={{ fontFamily: fontFamilies.interMedium }}>
            What files do I need?
          </Button>
        </View>
      </View>
    );
  }

  // Has models but none loaded, library has models
  if (!loadedModel && hasModelInLib) {
    return (
      <View style={styles.center}>
        <View style={[styles.inlineRow, { backgroundColor: c.surfaceRaised, borderColor: c.hairline }]}>
          <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 15, flex: 1 }}>Choose a model for this chat</Text>
          <Button mode="contained" onPress={onOpenModelMenu} compact labelStyle={{ fontFamily: fontFamilies.interMedium }}>Choose</Button>
        </View>
      </View>
    );
  }

  // Model ready, empty chat
  if (loadedModel) {
    const quant = loadedModel.quantization;
    const paramLabel = loadedModel.parameterLabel;
    return (
      <View style={styles.readyContainer}>
        <Text style={[styles.modelName, { color: c.text, fontFamily: typeScale.display.fontFamily }]} numberOfLines={2}>
          {loadedModel.displayName}
        </Text>
        {(quant || paramLabel) && (
          <View style={styles.chipRow}>
            {quant && <Chip style={[styles.chip, { backgroundColor: c.surfaceRaised }]} textStyle={[styles.chipText, { color: c.textSecondary, fontFamily: fontFamilies.mono }]}>{quant}</Chip>}
            {paramLabel && <Chip style={[styles.chip, { backgroundColor: c.surfaceRaised }]} textStyle={[styles.chipText, { color: c.textSecondary, fontFamily: fontFamilies.mono }]}>{paramLabel}</Chip>}
          </View>
        )}
        <View style={styles.suggestionsWrap}>
          {SUGGESTIONS.map((s, i) => (
            <Pressable key={i} onPress={() => onSuggestion(s.text)} style={[styles.suggChip, { backgroundColor: c.surfaceRaised, borderColor: c.hairline }]}>
              <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 14 }}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  focalCard: { padding: spacing.lg, borderRadius: radii.card, alignItems: 'center', maxWidth: 340, width: '100%', gap: spacing.sm },
  focalTitle: { fontSize: 18, lineHeight: 24, textAlign: 'center' },
  focalBody: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  focalBtn: { marginTop: spacing.xs, borderRadius: radii.button },
  inlineRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, gap: 12, width: '100%', maxWidth: 400 },
  readyContainer: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  modelName: { fontSize: 26, lineHeight: 32 },
  chipRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  chip: { borderRadius: 8 },
  chipText: { fontSize: 12 },
  suggestionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.lg },
  suggChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.chip, borderWidth: StyleSheet.hairlineWidth },
});
