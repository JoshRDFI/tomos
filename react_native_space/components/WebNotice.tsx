import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text, useTheme, Icon } from 'react-native-paper';
import type { AppTheme } from '@/constants/theme';
import { spacing, typeScale, fontFamilies } from '@/constants/theme';

export default function WebNotice() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  if (Platform.OS !== 'web') return null;
  return (
    <View style={[styles.container, { backgroundColor: c.brandTint }]}>
      <Icon source="cellphone" size={48} color={c.brand} />
      <Text style={[styles.title, { color: c.text, fontFamily: typeScale.title.fontFamily }]}>On-device inference requires the Android app</Text>
      <Text style={[styles.body, { color: c.textSecondary, fontFamily: fontFamilies.inter }]}>
        Build and install the APK to use Local Chat. The web preview shows the UI layout only.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, borderRadius: 12, alignItems: 'center', margin: spacing.md, gap: spacing.sm },
  title: { fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: spacing.xs },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
