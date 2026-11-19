// Import a persona from a Markdown file the user picks (e.g. soul.md in Downloads).
import * as DocPicker from 'expo-document-picker';
import { copyAsync } from 'expo-file-system/legacy';
import { Paths, File } from 'expo-file-system';
import * as db from './db';
import { parsePersonaMarkdown } from './personaMarkdown';
import { uniqueName } from './personas';
import type { Persona } from '@/types';

/** null = the picker was cancelled. */
export type PersonaImportResult = { persona: Persona } | { error: string } | null;

export async function importPersonaFromFile(): Promise<PersonaImportResult> {
  try {
    const result = await DocPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    // Content URIs (Downloads, Drive…) are copied in first; File can't read them directly.
    const tmp = new File(Paths.cache, 'persona-import.md');
    if (tmp.exists) tmp.delete();
    let text: string;
    try {
      await copyAsync({ from: asset.uri, to: tmp.uri });
      text = await tmp.text();
    } finally {
      if (tmp.exists) tmp.delete();
    }
    const draft = parsePersonaMarkdown(text, asset.name ?? 'Imported persona');
    if (!draft.content.trim()) return { error: 'That file has no instructions in it.' };
    const now = Date.now();
    const persona: Persona = {
      ...draft,
      id: db.generateId(),
      name: uniqueName(draft.name, (await db.getAllPersonas()).map((p) => p.name)),
      createdAt: now,
      updatedAt: now,
    };
    await db.insertPersona(persona);
    return { persona };
  } catch (e) {
    return { error: 'Couldn\'t read that file: ' + String((e as any)?.message ?? e) };
  }
}
