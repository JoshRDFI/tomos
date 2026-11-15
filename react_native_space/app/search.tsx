import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Platform, TextInput, Pressable } from 'react-native';
import { Text, useTheme, IconButton } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies } from '@/constants/theme';
import * as db from '@/lib/db';
import type { SearchResult } from '@/types';

export default function SearchScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWeb = Platform.OS === 'web';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (isWeb || q.trim().length === 0) {
      setResults([]);
      setSearched(q.trim().length > 0);
      return;
    }
    try {
      const r = await db.searchMessages(q.trim());
      setResults(r);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    }
  }, [isWeb]);

  const handleChange = useCallback((text: string) => {
    setQuery(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(text), 250);
  }, [doSearch]);

  const handleSelect = useCallback((r: SearchResult) => {
    // Navigate back to chat with this session
    router.back();
    // The chat screen will need to switch to this session
    // For now we store the target in a setting
    db.setSetting('lastSessionId', r.sessionId).catch(() => {});
  }, [router]);

  const renderSnippet = (snippet: string) => {
    // Highlight matched terms between << and >>
    const parts = snippet.split(/(<<[^>]*>>)/);
    return parts.map((part, i) => {
      if (part.startsWith('<<') && part.endsWith('>>')) {
        return <Text key={i} style={{ color: c.brand, fontWeight: '600' }}>{part.slice(2, -2)}</Text>;
      }
      return <Text key={i}>{part}</Text>;
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.hairline }]}>
        <IconButton icon="arrow-left" iconColor={c.text} onPress={() => router.back()} />
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: c.text, fontFamily: fontFamilies.inter }]}
          value={query}
          onChangeText={handleChange}
          placeholder="Search across all your chats"
          placeholderTextColor={c.textSecondary}
          autoFocus
          returnKeyType="search"
        />
        {query.length > 0 && <IconButton icon="close" iconColor={c.textSecondary} onPress={() => { setQuery(''); setResults([]); setSearched(false); }} />}
      </View>

      {!searched && !query && (
        <View style={styles.hint}>
          <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14, textAlign: 'center' }}>Search across all your chats</Text>
        </View>
      )}

      {searched && results.length === 0 && (
        <View style={styles.hint}>
          <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14 }}>No matches for '{query}'</Text>
        </View>
      )}

      {results.length > 0 && (
        <FlashList
          data={results}
          keyExtractor={(item) => item.messageId}
          renderItem={({ item }) => (
            <Pressable onPress={() => handleSelect(item)} style={[styles.resultRow, { borderBottomColor: c.hairline }]}>
              <Text numberOfLines={1} style={[styles.resultTitle, { color: c.text, fontFamily: fontFamilies.interSemiBold }]}>{item.sessionTitle}</Text>
              <Text numberOfLines={2} style={[styles.resultSnippet, { color: c.textSecondary, fontFamily: fontFamilies.inter }]}>{renderSnippet(item.snippet ?? item.content ?? '')}</Text>
              <Text style={[styles.resultMeta, { color: c.textSecondary, fontFamily: fontFamilies.inter }]}>
                {item.role === 'user' ? 'You' : 'Assistant'} · {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', height: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, fontSize: 16, height: 44 },
  hint: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  resultRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  resultTitle: { fontSize: 14, lineHeight: 18 },
  resultSnippet: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  resultMeta: { fontSize: 12, lineHeight: 16, marginTop: 4 },
});
