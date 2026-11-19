import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { Text, Button, Card, FAB, Snackbar, useTheme } from 'react-native-paper';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import * as db from '@/lib/db';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies, radii } from '@/constants/theme';
import type { Persona } from '@/types';
import { uniqueName } from '@/lib/personas';
import type { PersonaDraft } from '@/lib/personaMarkdown';
import { importPersonaFromFile } from '@/lib/personaImport';

const STARTERS: PersonaDraft[] = [
  { name: 'Concise assistant', content: 'You are a helpful, concise assistant. Answer briefly and directly.', greeting: null, examples: [], params: {} },
  { name: 'Code reviewer', content: 'You are a senior software engineer. Review code for bugs, performance issues, and style. Be precise and constructive.', greeting: null, examples: [], params: {} },
  { name: 'Writing editor', content: 'You are a professional writing editor. Improve clarity, grammar, and flow while preserving the author\'s voice.', greeting: null, examples: [], params: {} },
  {
    name: 'Friendly explainer',
    content: 'You explain things simply and warmly, like a patient friend. Use everyday analogies, keep answers short, and check whether the explanation landed.',
    greeting: 'Hi! What would you like to understand today?',
    examples: [
      { user: 'What is an API?', assistant: 'Think of a restaurant menu: it lists what you can order without showing the kitchen. An API is that menu for software. Does that picture help?' },
      { user: 'Why is the sky blue?', assistant: 'Sunlight holds every colour, and air scatters blue light the most, so blue reaches your eyes from all over the sky. Want the sunset version too?' },
    ],
    params: {},
  },
];

/** Settings → Personas: the list, starters, and Markdown import. */
export default function PersonasScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();
  const isWeb = Platform.OS === 'web';
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [snack, setSnack] = useState('');

  const refresh = useCallback(async () => {
    if (isWeb) return;
    setPersonas(await db.getAllPersonas());
  }, [isWeb]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const add = async (d: PersonaDraft): Promise<string> => {
    const now = Date.now();
    const id = db.generateId();
    const name = uniqueName(d.name, (await db.getAllPersonas()).map((p) => p.name));
    await db.insertPersona({ ...d, id, name, createdAt: now, updatedAt: now });
    return id;
  };

  const addStarter = async (d: PersonaDraft) => {
    await add(d);
    refresh();
    setSnack(`Added ${d.name}`);
  };

  const importFile = async () => {
    const r = await importPersonaFromFile();
    if (!r) return;
    if ('error' in r) { setSnack(r.error); return; }
    router.push({ pathname: '/settings/persona', params: { id: r.persona.id } });
  };

  const missingStarters = STARTERS.filter((s) => !personas.some((p) => p.name === s.name));

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Personas',
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerRight: () => <Button onPress={importFile} textColor={c.brand} icon="file-import-outline">Import</Button>,
        }}
      />
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 96 }}>
          <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 }}>
            A persona is a set of instructions, plus an optional greeting, example exchanges and settings. Pick one per chat. Examples shape the tone more than descriptions do.
          </Text>

          {personas.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push({ pathname: '/settings/persona', params: { id: p.id } })}
              style={[styles.row, { borderBottomColor: c.hairline }]}
              accessibilityRole="button"
            >
              <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>{p.name}</Text>
              <Text numberOfLines={2} style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13, marginTop: 2 }}>{p.content}</Text>
            </Pressable>
          ))}

          {missingStarters.length > 0 && (
            <>
              <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.interMedium, fontSize: 13, marginTop: spacing.sm }}>
                {personas.length ? 'More to start from' : 'Start with one of these'}
              </Text>
              {missingStarters.map((s) => (
                <Card key={s.name} style={[styles.starterCard, { backgroundColor: c.surfaceRaised, borderColor: c.hairline }]} onPress={() => addStarter(s)}>
                  <Card.Content>
                    <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>{s.name}</Text>
                    <Text numberOfLines={2} style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13, marginTop: 4 }}>{s.content}</Text>
                    {(s.greeting || s.examples.length > 0) && (
                      <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 12, marginTop: 4 }}>
                        With a greeting and {s.examples.length} example exchanges
                      </Text>
                    )}
                  </Card.Content>
                </Card>
              ))}
            </>
          )}
        </ScrollView>

        <FAB icon="plus" onPress={() => router.push('/settings/persona')} style={[styles.fab, { backgroundColor: c.brand }]} color={c.background} label="New persona" />
      </View>
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  starterCard: { borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  fab: { position: 'absolute', right: 16, bottom: 16, borderRadius: 28 },
});
