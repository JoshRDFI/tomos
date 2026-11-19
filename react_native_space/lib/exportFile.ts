// Exporting a chat, persona or backup: save it on the phone (Android's "save
// as" picker, no network) or hand it to another app through the share sheet.
import { Alert, Platform } from 'react-native';

export type ExportChoice = 'save' | 'share' | 'cancel';

export interface ExportDeps {
  choose(title: string): Promise<ExportChoice>;
  /** False when the picker was cancelled. */
  save(name: string, mimeType: string, content: string): Promise<boolean>;
  share(name: string, mimeType: string, content: string, title: string): Promise<void>;
}

/** A file name from a title: letters, digits, spaces, dashes and underscores. */
export function exportFileName(title: string | null | undefined, ext: string, fallback = 'export'): string {
  const base = (title ?? '').trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
  return (base || fallback) + ext;
}

const defaultDeps: ExportDeps = {
  choose: (title) => new Promise((resolve) => Alert.alert(
    title,
    'Save the file on this phone, or send it to another app.',
    [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
      { text: 'Share…', onPress: () => resolve('share') },
      { text: 'Save to phone', onPress: () => resolve('save') },
    ],
    { cancelable: true, onDismiss: () => resolve('cancel') },
  )),
  save: async (name, mimeType, content) => {
    if (Platform.OS !== 'android') return false;
    const m = require('../modules/save-file').default as { saveDocument(n: string, m: string, c: string): Promise<boolean> };
    return m.saveDocument(name, mimeType, content);
  },
  share: async (name, mimeType, content, title) => {
    const { Paths, File } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.write(content);
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: title });
  },
};

export async function exportText(
  file: { name: string; mimeType: string; content: string; title?: string },
  deps: ExportDeps = defaultDeps,
): Promise<'saved' | 'shared' | 'cancelled'> {
  const title = file.title ?? 'Export';
  const choice = await deps.choose(title);
  if (choice === 'save') return (await deps.save(file.name, file.mimeType, file.content)) ? 'saved' : 'cancelled';
  if (choice === 'share') {
    await deps.share(file.name, file.mimeType, file.content, title);
    return 'shared';
  }
  return 'cancelled';
}
