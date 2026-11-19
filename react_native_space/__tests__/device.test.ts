import { fastCoreCount, needsBatteryExemption } from '../lib/device';

const GHZ = 1_000_000; // sysfs reports kHz

describe('fastCoreCount', () => {
  it('Pixel 9 (Tensor G4: 1×3.1 + 3×2.6 + 4×1.92 GHz) → 4', () => {
    expect(fastCoreCount([1.92, 1.92, 1.92, 1.92, 2.6, 2.6, 2.6, 3.1].map((f) => f * GHZ))).toBe(4);
  });
  it('Snapdragon 8 Gen 3 (1×3.3 + 5×3.0 + 2×2.27 GHz) → 6', () => {
    expect(fastCoreCount([2.27, 2.27, 2.96, 2.96, 3.15, 3.15, 3.15, 3.3].map((f) => f * GHZ))).toBe(6);
  });
  it('Snapdragon 8 Elite (2×4.32 + 6×3.53 GHz, no efficiency cores) → 8', () => {
    expect(fastCoreCount([3.53, 3.53, 3.53, 3.53, 3.53, 3.53, 4.32, 4.32].map((f) => f * GHZ))).toBe(8);
  });
  it('mid-range (2×2.4 + 6×1.8 GHz) → 2', () => {
    expect(fastCoreCount([1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 2.4, 2.4].map((f) => f * GHZ))).toBe(2);
  });
  it('no readable frequencies → 4', () => {
    expect(fastCoreCount([])).toBe(4);
    expect(fastCoreCount([0, 0])).toBe(4);
  });
});

describe('needsBatteryExemption', () => {
  it.each(['samsung', 'Xiaomi', 'OnePlus', 'OPPO', 'vivo', 'HUAWEI', 'HONOR', 'realme'])('%s → yes', (m) => {
    expect(needsBatteryExemption(m)).toBe(true);
  });
  it.each(['Google', 'motorola', undefined, ''])('%s → no', (m) => {
    expect(needsBatteryExemption(m)).toBe(false);
  });
});
