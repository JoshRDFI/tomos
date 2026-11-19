// Phone-specific defaults: how many threads to generate with, and whether the
// phone's maker is known to stop background apps despite a foreground service.
import { Platform } from 'react-native';

const FALLBACK_THREADS = 4;

/**
 * Cores within 80% of the fastest core's top speed. Phones mix fast cores with
 * efficiency cores, and generation slows down once work spills onto the slow
 * ones, so the fast cores are the right thread count.
 */
export function fastCoreCount(maxFreqsKHz: number[]): number {
  const freqs = maxFreqsKHz.filter((f) => f > 0);
  if (freqs.length === 0) return FALLBACK_THREADS;
  const top = Math.max(...freqs);
  return Math.min(8, freqs.filter((f) => f >= 0.8 * top).length);
}

// Makers whose Android builds kill background apps on top of stock Android's
// rules (https://dontkillmyapp.com). On these, a reply only finishes with the
// screen off if battery optimization is off for the app.
const AGGRESSIVE = ['samsung', 'xiaomi', 'redmi', 'poco', 'oneplus', 'oppo', 'realme', 'vivo', 'iqoo', 'huawei', 'honor', 'meizu', 'asus', 'tecno', 'infinix', 'nubia'];

export function needsBatteryExemption(manufacturer: string | undefined): boolean {
  return !!manufacturer && AGGRESSIVE.includes(manufacturer.toLowerCase());
}

interface DeviceNative {
  cpuMaxFrequencies(): number[];
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
}

function native(): DeviceNative | null {
  if (Platform.OS !== 'android') return null;
  return require('../modules/generation-service').default as DeviceNative;
}

let threads: number | null = null;

/** This phone's fast-core count (read once), or 4 when it can't be read. */
export function defaultThreads(): number {
  if (threads == null) {
    try {
      threads = fastCoreCount(native()?.cpuMaxFrequencies() ?? []);
    } catch (e) {
      console.warn('[device] cpu info failed', e);
      threads = FALLBACK_THREADS;
    }
  }
  return threads;
}

/** True when this phone's maker kills background apps and the app isn't exempt yet. */
export function shouldAskBatteryExemption(): boolean {
  if (Platform.OS !== 'android') return false;
  const c = Platform.constants as { Manufacturer?: string; Brand?: string };
  if (!needsBatteryExemption(c.Manufacturer) && !needsBatteryExemption(c.Brand)) return false;
  try {
    return !native()?.isIgnoringBatteryOptimizations();
  } catch {
    return false;
  }
}

/** Opens Android's "let the app run in the background?" dialog. */
export function requestBatteryExemption(): void {
  try {
    native()?.requestIgnoreBatteryOptimizations();
  } catch (e) {
    console.warn('[device] battery request failed', e);
  }
}
