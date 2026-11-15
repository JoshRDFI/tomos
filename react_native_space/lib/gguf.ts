const QUANT_REGEX = /(IQ\d_[A-Z_]+|Q\d_K_[SML]|Q\d_K|Q\d_\d|F16|BF16|F32)/i;

export function parseQuantFromFilename(fileName: string): string | null {
  const m = fileName?.match?.(QUANT_REGEX);
  return m?.[1]?.toUpperCase?.() ?? null;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function memoryHint(fileSizeBytes: number, totalRam: number): 'fits' | 'tight' | 'too_large' {
  if (!totalRam || totalRam <= 0) return 'fits';
  const ratio = fileSizeBytes / totalRam;
  if (ratio <= 0.4) return 'fits';
  if (ratio <= 0.6) return 'tight';
  return 'too_large';
}
