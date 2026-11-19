import { requireNativeModule } from 'expo-modules-core';

interface SaveFileNative {
  /** Opens Android's "save as" picker and writes the text there. False when cancelled. */
  saveDocument(name: string, mimeType: string, content: string): Promise<boolean>;
}

export default requireNativeModule<SaveFileNative>('SaveFile');
