import { requireNativeModule } from 'expo-modules-core';

export interface NativeDlInfo {
  id: number;
  status: 'pending' | 'running' | 'paused' | 'succeeded' | 'failed' | 'missing';
  bytesSoFar: number;
  totalBytes: number;
  reason: number | null;
  localPath: string | null;
}

interface HfDownloadNative {
  externalModelsDir(): string;
  enqueue(o: { url: string; relativePath: string; title: string; wifiOnly: boolean }): Promise<number>;
  query(ids: number[]): Promise<NativeDlInfo[]>;
  remove(ids: number[]): Promise<void>;
}

export default requireNativeModule<HfDownloadNative>('HfDownload');
