import { requireNativeModule } from 'expo-modules-core';

interface GenerationServiceNative {
  start(o: { title: string; text: string }): boolean;
  stop(): void;
  notifyDone(o: { title: string; body: string; subtitle: string | null; sessionId: string }): void;
  addListener(event: 'onStopRequest', listener: () => void): { remove(): void };
}

export default requireNativeModule<GenerationServiceNative>('GenerationService');
