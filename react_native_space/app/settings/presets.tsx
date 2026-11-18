import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, ScrollView, Pressable } from 'react-native';
import { Text, FAB, useTheme, Dialog, Portal, Button, TextInput as PaperInput, Snackbar, IconButton, Menu, Card, Divider } from 'react-native-paper';
import { Stack } from 'expo-router';
import type { AppTheme } from '@/constants/theme';
import { blankPersona } from '@/lib/personas';
import { spacing, radii, fontFamilies, typeScale } from '@/constants/theme';
import * as db from '@/lib/db';
import type { Persona } from '@/types';

const STARTERS = [
  { name: 'Concise assistant', content: 'You are a helpful, concise assistant. Answer briefly and directly.' },
  { name: 'Code reviewer', content: 'You are a senior software engineer. Review code for bugs, performance issues, and style. Be precise and constructive.' },
  { name: 'Writing editor', content: 'You are a professional writing editor. Improve clarity, grammar, and flow while preserving the author\'s voice.' },
];

export default function PresetsScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.appColors;
  const isWeb = Platform.OS === 'web';

  const [presets, setPresets] = useState<Persona[]>([]);
  const [editDialog, setEditDialog] = useState<Persona | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [nameError, setNameError] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<Persona | null>(null);
  const [snack, setSnack] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (isWeb) return;
    const p = await db.getAllPresets();
    setPresets(p);
  }, [isWeb]);

  useEffect(() => { refresh(); }, [refresh]);

  const openNew = () => {
    setIsNew(true);
    setEditName('');
    setEditContent('');
    setNameError('');
    setEditDialog(blankPersona({ id: '', name: '', content: '', createdAt: 0 }));
  };

  const openEdit = (p: Persona) => {
    setIsNew(false);
    setEditName(p.name);
    setEditContent(p.content);
    setNameError('');
    setEditDialog(p);
  };

  const handleSave = async () => {
    if (!editName.trim()) { setNameError('Name is required'); return; }
    const dup = await db.presetNameExists(editName.trim(), isNew ? undefined : editDialog?.id);
    if (dup) { setNameError('A preset with this name already exists'); return; }

    if (isNew) {
      await db.insertPreset(blankPersona({ id: db.generateId(), name: editName.trim(), content: editContent, createdAt: Date.now() }));
    } else if (editDialog) {
      await db.updatePreset(editDialog.id, { name: editName.trim(), content: editContent });
    }
    setEditDialog(null);
    refresh();
    setSnack(isNew ? 'Preset created' : 'Preset updated');
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;
    await db.deletePreset(deleteDialog.id);
    setDeleteDialog(null);
    refresh();
    setSnack('Preset deleted');
  };

  const addStarter = async (starter: typeof STARTERS[number]) => {
    const exists = await db.presetNameExists(starter.name);
    if (exists) { setSnack('Preset already exists'); return; }
    await db.insertPreset(blankPersona({ id: db.generateId(), name: starter.name, content: starter.content, createdAt: Date.now() }));
    refresh();
    setSnack('Preset added');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'System Prompt Presets', headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text }} />
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 80 }}>
          {presets.length === 0 && (
            <>
              <Text style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 14, textAlign: 'center', marginBottom: 8 }}>No presets yet. Start with a suggestion:</Text>
              {STARTERS.map((s, i) => (
                <Card key={i} style={[styles.starterCard, { backgroundColor: c.surfaceRaised, borderColor: c.hairline }]} onPress={() => addStarter(s)}>
                  <Card.Content>
                    <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>{s.name}</Text>
                    <Text numberOfLines={2} style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13, marginTop: 4 }}>{s.content}</Text>
                  </Card.Content>
                </Card>
              ))}
            </>
          )}

          {presets.map((p) => (
            <Pressable key={p.id} onPress={() => openEdit(p)} style={[styles.presetRow, { borderBottomColor: c.hairline }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontFamily: fontFamilies.interMedium, fontSize: 15 }}>{p.name}</Text>
                <Text numberOfLines={2} style={{ color: c.textSecondary, fontFamily: fontFamilies.inter, fontSize: 13, marginTop: 2 }}>{p.content}</Text>
              </View>
              <Menu
                visible={menuId === p.id}
                onDismiss={() => setMenuId(null)}
                anchor={<IconButton icon="dots-vertical" size={18} iconColor={c.textSecondary} onPress={() => setMenuId(p.id)} />}
              >
                <Menu.Item title="Edit" onPress={() => { setMenuId(null); openEdit(p); }} />
                <Menu.Item title="Delete" onPress={() => { setMenuId(null); setDeleteDialog(p); }} titleStyle={{ color: c.error }} />
              </Menu>
            </Pressable>
          ))}
        </ScrollView>

        <FAB icon="plus" onPress={openNew} style={[styles.fab, { backgroundColor: c.brand }]} color={c.background} label="New preset" />
      </View>

      <Portal>
        <Dialog visible={!!editDialog} onDismiss={() => setEditDialog(null)}>
          <Dialog.Title>{isNew ? 'New preset' : 'Edit preset'}</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 400 }}>
            <ScrollView>
              <PaperInput value={editName} onChangeText={(t) => { setEditName(t); setNameError(''); }} mode="outlined" label="Name" error={!!nameError} style={{ marginBottom: 12 }} />
              {!!nameError && <Text style={{ color: c.error, fontSize: 12, marginBottom: 8 }}>{nameError}</Text>}
              <PaperInput value={editContent} onChangeText={setEditContent} mode="outlined" label="Content" multiline numberOfLines={5} />
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setEditDialog(null)}>Cancel</Button>
            <Button onPress={handleSave}>Save</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={!!deleteDialog} onDismiss={() => setDeleteDialog(null)}>
          <Dialog.Title>Delete preset?</Dialog.Title>
          <Dialog.Actions>
            <Button onPress={() => setDeleteDialog(null)}>Cancel</Button>
            <Button onPress={handleDelete} textColor={c.error}>Delete</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={2000}>{snack}</Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  starterCard: { borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth },
  presetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  fab: { position: 'absolute', right: 16, bottom: 16, borderRadius: 28 },
});
