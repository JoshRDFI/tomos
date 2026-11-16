import { parseQuantFromFilename, isPrismOnlyQuant } from '../lib/gguf';
import { base64ToBytes, checkCompatibility, readGgufHeader, GgufError, type ByteSource } from '../lib/ggufHeader';

describe('parseQuantFromFilename', () => {
  it.each([
    ['Qwen3-8B-Q4_K_M.gguf', 'Q4_K_M'],
    ['model.q8_0.gguf', 'Q8_0'],
    ['Bonsai-2-8B-PQ2_0.gguf', 'PQ2_0'],
    ['Bonsai-2-8B-PTQ1_0.gguf', 'PTQ1_0'],
    ['Bonsai-2-8B-Q2_0.gguf', 'Q2_0'],
    ['gemma-3-4b-it-IQ4_XS.gguf', 'IQ4_XS'],
    ['Qwen3-4B-UD-Q4_K_XL.gguf', 'Q4_K_XL'],
    ['llama-3.2-1b-instruct-f16.gguf', 'F16'],
    ['model-BF16.gguf', 'BF16'],
    ['notes.gguf', null],
  ])('%s → %s', (name, quant) => {
    expect(parseQuantFromFilename(name)).toBe(quant);
  });

  it('flags PrismML-only packings', () => {
    expect(isPrismOnlyQuant('PQ2_0')).toBe(true);
    expect(isPrismOnlyQuant('PTQ1_0')).toBe(true);
    expect(isPrismOnlyQuant('Q2_0')).toBe(false);
    expect(isPrismOnlyQuant(null)).toBe(false);
  });
});

// ── Build a small GGUF in memory ──

class W {
  parts: number[] = [];
  u8(v: number) { this.parts.push(v & 0xff); }
  u32(v: number) { for (let i = 0; i < 4; i++) this.u8(v >>> (8 * i)); }
  u64(v: number) { this.u32(v % 2 ** 32); this.u32(Math.floor(v / 2 ** 32)); }
  str(s: string) { const b = Buffer.from(s, 'utf8'); this.u64(b.length); b.forEach((x) => this.u8(x)); }
  bytes() { return Uint8Array.from(this.parts); }
}

function gguf(tensorTypes: number[], fileType = 15, vocab = 3): Uint8Array {
  const w = new W();
  'GGUF'.split('').forEach((ch) => w.u8(ch.charCodeAt(0)));
  w.u32(3);
  w.u64(tensorTypes.length);
  w.u64(4);
  w.str('general.architecture'); w.u32(8); w.str('qwen3');
  w.str('general.file_type'); w.u32(4); w.u32(fileType);
  w.str('tokenizer.ggml.tokens'); w.u32(9); w.u32(8); w.u64(vocab);
  for (let i = 0; i < vocab; i++) w.str(`tok${i}`);
  w.str('tokenizer.ggml.scores'); w.u32(9); w.u32(6); w.u64(vocab);
  for (let i = 0; i < vocab * 4; i++) w.u8(0);
  tensorTypes.forEach((t, i) => {
    w.str(`blk.${i}.weight`);
    w.u32(2); w.u64(4096); w.u64(4096);
    w.u32(t);
    w.u64(i * 1024);
  });
  // some tensor data after the header
  for (let i = 0; i < 64; i++) w.u8(0xaa);
  return w.bytes();
}

const sourceOf = (bytes: Uint8Array, calls?: number[]): ByteSource => async (offset, length) => {
  calls?.push(offset);
  return bytes.slice(offset, offset + length);
};

describe('readGgufHeader', () => {
  it('reads metadata and tensor types, skipping arrays', async () => {
    const h = await readGgufHeader(sourceOf(gguf([12, 12, 14, 0])));
    expect(h.version).toBe(3);
    expect(h.metadata['general.architecture']).toBe('qwen3');
    expect(h.metadata['tokenizer.ggml.tokens']).toBeUndefined();
    expect([...h.tensorTypes.entries()]).toEqual([[12, 2], [14, 1], [0, 1]]);
    expect(checkCompatibility(h)).toEqual({ ok: true, unsupportedTypes: [], fileType: 'Q4_K_M' });
  });

  it('reports tensor types this llama.cpp lacks', async () => {
    const h = await readGgufHeader(sourceOf(gguf([0, 47, 47, 4])));
    expect(checkCompatibility(h)).toEqual({ ok: false, unsupportedTypes: ['Q4_2', 'type 47'], fileType: 'Q4_K_M' });
  });

  it('reads headers larger than one chunk', async () => {
    const calls: number[] = [];
    const h = await readGgufHeader(sourceOf(gguf([8], 7, 200_000), calls));
    expect(h.tensorTypes.get(8)).toBe(1);
    expect(calls.length).toBeGreaterThan(1);
    expect(checkCompatibility(h).fileType).toBe('Q8_0');
  });

  it('rejects files that are not GGUF', async () => {
    await expect(readGgufHeader(sourceOf(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])))).rejects.toBeInstanceOf(GgufError);
  });

  it('rejects a truncated header', async () => {
    const full = gguf([12]);
    await expect(readGgufHeader(sourceOf(full.slice(0, 40)))).rejects.toBeInstanceOf(GgufError);
  });
});

it('base64ToBytes', () => {
  expect(Array.from(base64ToBytes(Buffer.from([0, 255, 71]).toString('base64')))).toEqual([0, 255, 71]);
});
