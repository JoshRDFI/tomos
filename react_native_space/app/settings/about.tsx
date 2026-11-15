import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, TextInput, Platform, Linking } from 'react-native';
import { Text, useTheme, Icon } from 'react-native-paper';
import { Stack } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import Constants from 'expo-constants';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, radii } from '@/constants/theme';

interface LicenseItem {
  name: string;
  version: string;
  license: string;
  url: string | null;
  textId: number | null;
}
interface LicenseData {
  generatedAt: string;
  sections: { title: string; items: LicenseItem[] }[];
  texts: string[];
}

type Row =
  | { type: 'header'; key: string; title: string; count: number }
  | { type: 'item'; key: string; item: LicenseItem };

function repoUrl(url: string | null): string | null {
  if (!url) return null;
  const u = url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
  if (/^github:/.test(u)) return `https://github.com/${u.slice(7)}`;
  if (/^[\w-]+\/[\w.-]+$/.test(u)) return `https://github.com/${u}`;
  return /^https?:\/\//.test(u) ? u : null;
}

export default function AboutScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [llamaBuild, setLlamaBuild] = useState<string | null>(null);

  // Loaded on demand: the list is large and only needed on this screen.
  const data = useMemo(() => require('@/constants/licenses.json') as LicenseData, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    import('llama.rn')
      .then((m) => setLlamaBuild(`b${m.BuildInfo.number} (${m.BuildInfo.commit})`))
      .catch(() => {});
  }, []);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    for (const s of data.sections) {
      const items = q
        ? s.items.filter((i) => i.name.toLowerCase().includes(q) || i.license.toLowerCase().includes(q))
        : s.items;
      if (items.length === 0) continue;
      out.push({ type: 'header', key: `h:${s.title}`, title: s.title, count: items.length });
      for (const item of items) out.push({ type: 'item', key: `${s.title}:${item.name}@${item.version}`, item });
    }
    return out;
  }, [data, query]);

  const version = Constants.expoConfig?.version ?? '';

  const header = (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.md }}>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <Text style={{ color: c.text, fontFamily: fontFamilies.interSemiBold, fontSize: 18 }}>{Constants.expoConfig?.name ?? 'LLM Chat'}</Text>
        <Text style={[styles.meta, { color: c.textSecondary }]}>Version {version}</Text>
        {llamaBuild && <Text style={[styles.meta, { color: c.textSecondary }]}>llama.cpp {llamaBuild}</Text>}
        <Text style={{ color: c.text, fontFamily: fontFamilies.inter, fontSize: 14, marginTop: 8 }}>
          Runs language models entirely on this phone. Chats, settings and model files never leave the device.
        </Text>
      </View>
      <Text style={{ color: c.text, fontFamily: fontFamilies.interSemiBold, fontSize: 16, marginTop: spacing.sm }}>Open-source licenses</Text>
      <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>
        This app is built on the open-source software below. Tap an entry to read its license.
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or license"
        placeholderTextColor={c.textSecondary}
        autoCapitalize="none"
        style={[styles.search, { color: c.text, borderColor: c.hairline, backgroundColor: c.surfaceRaised, fontFamily: fontFamilies.inter }]}
      />
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'About', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <FlashList
          data={rows}
          keyExtractor={(r) => r.key}
          getItemType={(r) => r.type}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          extraData={expanded}
          renderItem={({ item: row }) => {
            if (row.type === 'header') {
              return (
                <Text style={{ color: c.brand, fontFamily: fontFamilies.interSemiBold, fontSize: 12, paddingTop: 12, paddingBottom: 4 }}>
                  {row.title.toUpperCase()} ({row.count})
                </Text>
              );
            }
            const { item } = row;
            const open = expanded === row.key;
            const link = repoUrl(item.url);
            return (
              <View style={[styles.item, { borderColor: c.hairline }]}>
                <Pressable onPress={() => setExpanded(open ? null : row.key)} style={styles.itemHeader} accessibilityRole="button">
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 14 }}>{item.name}</Text>
                    <Text style={[styles.meta, { color: c.textSecondary }]}>{[item.version, item.license].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Icon source={open ? 'chevron-up' : 'chevron-down'} size={20} color={c.textSecondary} />
                </Pressable>
                {open && (
                  <View style={{ gap: 8, paddingBottom: 12 }}>
                    {link && (
                      <Text onPress={() => Linking.openURL(link)} style={{ color: c.brand, fontFamily: fontFamilies.inter, fontSize: 13 }}>{link}</Text>
                    )}
                    <Text selectable style={[styles.licenseText, { color: c.text, backgroundColor: c.codeBg }]}>
                      {item.textId != null
                        ? data.texts[item.textId]
                        : `This package is distributed under the ${item.license} license. Its package does not include a separate license file; see the project link above for the full text.`}
                    </Text>
                  </View>
                )}
              </View>
            );
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  meta: { fontFamily: fontFamilies.mono, fontSize: 12 },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
  itemHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  licenseText: { fontFamily: fontFamilies.mono, fontSize: 11, lineHeight: 16, padding: 10, borderRadius: 6 },
});
