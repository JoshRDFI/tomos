// The only entry point to the download backend. Today that's Android's
// DownloadManager (modules/hf-download); keep this interface stable so the
// backend can be swapped without touching callers.
import { Platform } from 'react-native';

export type DlStatus = 'pending' | 'running' | 'paused' | 'succeeded' | 'failed' | 'missing';
export interface DlInfo {
  id: number;
  status: DlStatus;
  bytesSoFar: number;
  totalBytes: number;
  reason: number | null;
  localPath: string | null;
}

export function isSupported(): boolean {
  return Platform.OS === 'android';
}

function native() {
  // Loaded lazily so tests and non-Android platforms never touch the native module.
  return require('../modules/hf-download').default as typeof import('../modules/hf-download').default;
}

export function enqueue(o: { url: string; relativePath: string; title: string; wifiOnly: boolean }): Promise<number> {
  return native().enqueue(o);
}

export function query(ids: number[]): Promise<DlInfo[]> {
  return native().query(ids);
}

export function remove(ids: number[]): Promise<void> {
  return native().remove(ids);
}

export function externalModelsDir(): string {
  return native().externalModelsDir();
}
