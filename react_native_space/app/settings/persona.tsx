import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text, Button, IconButton, TextInput as PaperInput, Dialog, Portal, Snackbar, useTheme } from 'react-native-paper';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as db from '@/lib/db';
import * as llama from '@/lib/llama';
import ParamEditor from '@/components/params/ParamEditor';
import type { AppTheme } from '@/constants/theme';
import { spacing, fontFamilies } from '@/constants/theme';
import { resolveParams, type ParamSet, type ResolvedParams } from '@/lib/params';
import { composeSystemMessage } from '@/lib/prompt';
import { estimateTokens } from '@/lib/personas';
import { serializePersonaMarkdown } from '@/lib/personaMarkdown';
import type { PersonaExample } from '@/types';

/** Create or edit one persona (route param `id`; none = new). */
export default function PersonaEditor() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isWeb = Platform.OS === 'web';

  const [loaded, setLoaded] = useState(!id);
  const [createdAt, setCreatedAt] = useState(Date.now());
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [greeting, setGreeting] = useState('');
  const [examples, setExamples] = useState<PersonaExample[]>([]);
  const [params, setParams] = useState<ParamSet>({});
  const [inherited, setInherited] = useState<ResolvedParams>(() => resolveParams({}));
  const [nameError, setNameError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tokens, setTokens] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [leaveAction, setLeaveAction] = useState<any>(null);
  const [snack, setSnack] = useState('');
  const savedRef = useRef(false);

  useEffect(() => {
    if (isWeb) return;
    (async () => {
      setInherited(resolveParams({ global: await db.getGlobalParams() }));
      if (!id) return;
      const p = await db.getPersona(id);
      if (!p) { router.back(); return; }
      setName(p.name);
      setContent(p.content);
      setGreeting(p.greeting ?? '');
      setExamples(p.examples);
      setParams(p.params);
      setCreatedAt(p.createdAt);
      setLoaded(true);
    })();
  }, [id, isWeb, router]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  // What the persona adds to every message.
  const systemText = useMemo(
    () => composeSystemMessage({ instructions: content, date: null, examples: examples.filter((e) => e.user.trim() && e.assistant.trim()), summary: null, carryOver: null }),
    [content, examples],
  );
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const n = llama.getLoadedModelId() ? await llama.countTokens(systemText) : estimateTokens(systemText);
      if (!cancelled) setTokens(n);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [systemText]);

  const save = useCallback(async (): Promise<boolean> => {
    const n = name.trim();
    if (!n) { setNameError('Name is required'); return false; }
    if (!content.trim()) { setSnack('Instructions are required'); return false; }
    if (await db.personaNameExists(n, id)) { setNameError('A persona with this name already exists'); return false; }
    const fields = {
      name: n,
      content: content.trim(),
      greeting: greeting.trim() || null,
      examples: examples.filter((e) => e.user.trim() && e.assistant.trim()).map((e) => ({ user: e.user.trim(), assistant: e.assistant.trim() })),
      params,
    };
    if (id) await db.updatePersona(id, fields);
    else await db.insertPersona({ ...fields, id: db.generateId(), createdAt, updatedAt: Date.now() });
    savedRef.current = true;
    setDirty(false);
    return true;
  }, [name, content, greeting, examples, params, id, createdAt]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!dirty || savedRef.current) return;
      e.preventDefault();
      setLeaveAction(e.data.action);
    });
    return unsub;
  }, [navigation, dirty]);

  const saveAndClose = async () => {
    if (await save()) router.back();
  };

  const exportFile = async () => {
    try {
      const { Paths, File } = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      const file = new File(Paths.cache, `${(name.trim() || 'persona').replace(/[^a-zA-Z0-9 _-]/g, '_')}.md`);
      if (file.exists) file.delete();
      file.write(serializePersonaMarkdown({ name: name.trim(), content: content.trim(), greeting: greeting.trim() || null, examples, params }));
      await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', dialogTitle: 'Export persona' });
    } catch (e) {
      setSnack('Export failed: ' + String((e as any)?.message ?? e));
    }
  };

  const remove = async () => {
    if (!id) return;
    await db.deletePersona(id);
    savedRef.current = true;
    setConfirmDelete(false);
    router.back();
  };

  const setExample = (i: number, field: keyof PersonaExample, v: string) =>
    edit(setExamples)(examples.map((e, j) => (j === i ? { ...e, [field]: v } : e)));

  if (!loaded) return <View style={{ flex: 1, backgroundColor: c.background }} />;

  const label = { color: c.text, fontFamily: fontFamilies.interSemiBold, fontSize: 15, marginTop: spacing.md } as const;
  const help = { color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13 } as const;

  return (
    <>
      <Stack.Screen
        options={{
          title: id ? 'Edit persona' : 'New persona',
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerRight: () => <Button onPress={saveAndClose} textColor={c.brand}>Save</Button>,
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <PaperInput label="Name" value={name} onChangeText={(t) => { edit(setName)(t); setNameError(''); }} mode="outlined" error={!!nameError} style={{ backgroundColor: c.surfaceRaised }} />
        {!!nameError && <Text style={{ color: c.error, fontSize: 12 }}>{nameError}</Text>}

        <Text style={label}>Instructions</Text>
        <Text style={help}>Who the model is and how it should reply. Sent as the system prompt.</Text>
        <PaperInput value={content} onChangeText={edit(setContent)} mode="outlined" multiline numberOfLines={6} style={{ backgroundColor: c.surfaceRaised }} />

        <Text style={label}>Greeting (optional)</Text>
        <Text style={help}>The chat's first reply. It sets the voice from the start.</Text>
        <PaperInput value={greeting} onChangeText={edit(setGreeting)} mode="outlined" multiline numberOfLines={2} style={{ backgroundColor: c.surfaceRaised }} />

        <Text style={label}>Example exchanges (optional)</Text>
        <Text style={help}>A few short samples of how it replies. Small models copy examples more reliably than they follow descriptions.</Text>
        {examples.map((e, i) => (
          <View key={i} style={[styles.example, { borderColor: c.hairline }]}>
            <View style={styles.exampleHeader}>
              <Text style={help}>Example {i + 1}</Text>
              <IconButton icon="close" size={18} iconColor={c.textSecondary} onPress={() => edit(setExamples)(examples.filter((_, j) => j !== i))} accessibilityLabel={`Remove example ${i + 1}`} />
            </View>
            <PaperInput label="User" value={e.user} onChangeText={(t) => setExample(i, 'user', t)} mode="outlined" multiline dense style={{ backgroundColor: c.surfaceRaised }} />
            <PaperInput label="Reply" value={e.assistant} onChangeText={(t) => setExample(i, 'assistant', t)} mode="outlined" multiline dense style={{ backgroundColor: c.surfaceRaised, marginTop: 6 }} />
          </View>
        ))}
        <Button mode="outlined" icon="plus" onPress={() => edit(setExamples)([...examples, { user: '', assistant: '' }])} style={{ alignSelf: 'flex-start' }}>Add example</Button>

        <Text style={[help, { marginTop: spacing.sm }]}>
          {tokens == null ? ' ' : `About ${tokens} tokens per message.`}
        </Text>

        <Text style={label}>Settings (optional)</Text>
        <Text style={help}>Sampling settings for chats using this persona. A chat's own settings still win.</Text>
        <ParamEditor overrides={params} inherited={inherited} onChange={edit(setParams)} completionOnly />

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          <Button mode="outlined" icon="export-variant" onPress={exportFile} disabled={!name.trim() || !content.trim()}>Export</Button>
          {!!id && <Button mode="outlined" icon="delete-outline" textColor={c.error} onPress={() => setConfirmDelete(true)}>Delete</Button>}
        </View>
      </ScrollView>

      <Portal>
        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Delete persona?</Dialog.Title>
          <Dialog.Content>
            <Text style={help}>Chats using it switch to the default system prompt. Their messages stay.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(false)}>Cancel</Button>
            <Button onPress={remove} textColor={c.error}>Delete</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!leaveAction} onDismiss={() => setLeaveAction(null)}>
          <Dialog.Title>Save changes?</Dialog.Title>
          <Dialog.Actions>
            <Button onPress={() => { const a = leaveAction; savedRef.current = true; setLeaveAction(null); navigation.dispatch(a); }}>Discard</Button>
            <Button onPress={async () => { const a = leaveAction; setLeaveAction(null); if (await save()) navigation.dispatch(a); }}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2500}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  example: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 8 },
  exampleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
