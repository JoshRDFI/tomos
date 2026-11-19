import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Icon, useTheme } from 'react-native-paper';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, radii } from '@/constants/theme';

interface Props {
  /** Title of the chat this one continues; null if it was deleted. */
  fromTitle: string | null;
  onOpen: () => void;
  onShowCarried: () => void;
}

/** "Continued from <chat>" at the top of a continued chat, with what was carried over. */
export default function ContinuedChip({ fromTitle, onOpen, onShowCarried }: Props) {
  const c = useTheme<AppTheme>().appColors;
  return (
    <View style={[styles.row, { borderBottomColor: c.hairline }]}>
      <Pressable
        onPress={fromTitle ? onOpen : undefined}
        onLongPress={onShowCarried}
        disabled={!fromTitle}
        accessibilityRole={fromTitle ? 'link' : 'text'}
        style={[styles.chip, { backgroundColor: c.surfaceRaised, borderColor: c.hairline }]}
      >
        <Icon source="link-variant" size={14} color={c.textSecondary} />
        <Text numberOfLines={1} style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 13, flexShrink: 1 }}>
          {fromTitle ? `Continued from ${fromTitle}` : 'Continued from a deleted chat'}
        </Text>
      </Pressable>
      <Pressable onPress={onShowCarried} accessibilityRole="button" hitSlop={8}>
        <Text style={{ color: c.brand, fontFamily: fontFamilies.interMedium, fontSize: 13 }}>What was carried</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.chip, borderWidth: StyleSheet.hairlineWidth },
});
