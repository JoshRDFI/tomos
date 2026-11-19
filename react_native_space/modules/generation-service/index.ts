import { requireNativeModule } from 'expo-modules-core';

interface GenerationServiceNative {
  start(o: { title: string; text: string; pausedText?: string | null }): boolean;
  stop(): void;
  notifyDone(o: { title: string; body: string; subtitle: string | null; sessionId: string }): void;
  progress(count: number): void;
  takeSqueezed(): boolean;
  cpuMaxFrequencies(): number[];
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  addListener(event: 'onStopRequest', listener: () => void): { remove(): void };
}

export default requireNativeModule<GenerationServiceNative>('GenerationService');
