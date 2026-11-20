// A quant name standing alone in the file name (not part of a longer word,
// so "PQ2_0" isn't read as "Q2_0"). Longer alternatives come first.
const QUANT_REGEX = /(?:^|[^A-Za-z0-9])(PTQ1_0|PQ2_0|TQ[12]_0|IQ\d_(?:XXS|XS|S|M|NL)|Q\d_K_(?:XL|S|M|L)|Q\d_K|Q\d_\d|MXFP4|NVFP4|BF16|F16|F32)(?=$|[^A-Za-z0-9])/i;

export function parseQuantFromFilename(fileName: string): string | null {
  const m = fileName?.match?.(QUANT_REGEX);
  return m?.[1]?.toUpperCase?.() ?? null;
}

/** PrismML's own packings, which need their llama.cpp fork. */
export function isPrismOnlyQuant(quant: string | null): boolean {
  return quant === 'PQ2_0' || quant === 'PTQ1_0';
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

/**
 * The file name to show under a model's name on its card, so a model renamed
 * to something like "Chat" still says which file it is. Null when the name is
 * already the file name.
 */
export function fileNameBelowName(m: { displayName: string; fileName: string }): string | null {
  const bare = (s: string) => s.trim().replace(/\.gguf$/i, '').toLowerCase();
  return bare(m.displayName) === bare(m.fileName) ? null : m.fileName;
}
