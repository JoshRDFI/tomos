/**
 * Read a GGUF file's header (metadata and tensor list) without loading the
 * model, to check the bundled llama.cpp can load it before a multi-GB copy.
 *
 * Layout (little-endian): magic "GGUF", u32 version, u64 tensor count,
 * u64 metadata count, metadata key/values, then per tensor: name, u32 n_dims,
 * u64 dims[n_dims], u32 type, u64 offset.
 */

/** Read `length` bytes at `offset` (may return fewer at end of file). */
export type ByteSource = (offset: number, length: number) => Promise<Uint8Array>;

/** ggml tensor types in llama.cpp b12292 (llama.rn 0.13.0-rc.11), ggml.h `enum ggml_type`. */
export const GGML_TYPE_NAMES: Record<number, string> = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 6: 'Q5_0', 7: 'Q5_1', 8: 'Q8_0', 9: 'Q8_1',
  10: 'Q2_K', 11: 'Q3_K', 12: 'Q4_K', 13: 'Q5_K', 14: 'Q6_K', 15: 'Q8_K',
  16: 'IQ2_XXS', 17: 'IQ2_XS', 18: 'IQ3_XXS', 19: 'IQ1_S', 20: 'IQ4_NL', 21: 'IQ3_S', 22: 'IQ2_S', 23: 'IQ4_XS',
  24: 'I8', 25: 'I16', 26: 'I32', 27: 'I64', 28: 'F64', 29: 'IQ1_M', 30: 'BF16',
  34: 'TQ1_0', 35: 'TQ2_0', 39: 'MXFP4', 40: 'NVFP4', 41: 'Q1_0', 42: 'Q2_0', 43: 'F8_E4M3',
};

/** Types this llama.cpp once had and no longer loads. */
const REMOVED_TYPE_NAMES: Record<number, string> = {
  4: 'Q4_2', 5: 'Q4_3', 31: 'Q4_0_4_4', 32: 'Q4_0_4_8', 33: 'Q4_0_8_8', 36: 'IQ4_NL_4_4', 37: 'IQ4_NL_4_8', 38: 'IQ4_NL_8_8',
};

/** llama.h `enum llama_ftype` → label, for `general.file_type`. */
export const FILE_TYPE_NAMES: Record<number, string> = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K',
  11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K',
  19: 'IQ2_XXS', 20: 'IQ2_XS', 21: 'Q2_K_S', 22: 'IQ3_XS', 23: 'IQ3_XXS', 24: 'IQ1_S', 25: 'IQ4_NL', 26: 'IQ3_S',
  27: 'IQ3_M', 28: 'IQ2_S', 29: 'IQ2_M', 30: 'IQ4_XS', 31: 'IQ1_M', 32: 'BF16', 36: 'TQ1_0', 37: 'TQ2_0',
  38: 'MXFP4', 39: 'NVFP4', 40: 'Q1_0', 41: 'Q2_0', 42: 'F8_E4M3',
};

export function typeName(id: number): string {
  return GGML_TYPE_NAMES[id] ?? REMOVED_TYPE_NAMES[id] ?? `type ${id}`;
}

export interface GgufHeader {
  version: number;
  tensorCount: number;
  /** Scalar and string metadata (arrays are skipped). */
  metadata: Record<string, string | number | boolean>;
  /** Tensor type id → number of tensors. */
  tensorTypes: Map<number, number>;
}

export class GgufError extends Error {}

const CHUNK = 1 << 20;
const MAX_HEADER = 256 * CHUNK; // a header bigger than this isn't a sane GGUF
const MAX_STRING = 64 * CHUNK;

/** Sequential little-endian reader over a ByteSource, fetching 1 MB at a time. */
class Reader {
  private buf = new Uint8Array(0);
  private bufStart = 0;
  pos = 0;
  constructor(private source: ByteSource) {}

  private async ensure(n: number) {
    const have = this.bufStart + this.buf.length - this.pos;
    if (have >= n) return;
    if (this.pos + n > MAX_HEADER) throw new GgufError('GGUF header is unreasonably large');
    let next = this.buf.subarray(this.pos - this.bufStart);
    let fileOffset = this.bufStart + this.buf.length;
    // A read may return less than asked for; keep going until there's enough
    // or the file ends.
    while (next.length < n) {
      const more = await this.source(fileOffset, Math.max(CHUNK, n - next.length));
      if (more.length === 0) break;
      const joined = new Uint8Array(next.length + more.length);
      joined.set(next, 0);
      joined.set(more, next.length);
      next = joined;
      fileOffset += more.length;
    }
    this.buf = next;
    this.bufStart = this.pos;
    if (next.length < n) throw new GgufError('File ends inside the GGUF header');
  }

  private view(n: number) {
    const off = this.pos - this.bufStart;
    this.pos += n;
    return new DataView(this.buf.buffer, this.buf.byteOffset + off, n);
  }

  async u8() { await this.ensure(1); return this.view(1).getUint8(0); }
  async i8() { await this.ensure(1); return this.view(1).getInt8(0); }
  async u16() { await this.ensure(2); return this.view(2).getUint16(0, true); }
  async i16() { await this.ensure(2); return this.view(2).getInt16(0, true); }
  async u32() { await this.ensure(4); return this.view(4).getUint32(0, true); }
  async i32() { await this.ensure(4); return this.view(4).getInt32(0, true); }
  async f32() { await this.ensure(4); return this.view(4).getFloat32(0, true); }
  async f64() { await this.ensure(8); return this.view(8).getFloat64(0, true); }
  /** 64-bit integers as JS numbers (exact up to 2^53, plenty for counts and sizes). */
  async u64() { await this.ensure(8); const v = this.view(8); return v.getUint32(0, true) + v.getUint32(4, true) * 2 ** 32; }
  async i64() { await this.ensure(8); const v = this.view(8); return v.getUint32(0, true) + v.getInt32(4, true) * 2 ** 32; }

  async bytes(n: number) {
    await this.ensure(n);
    const off = this.pos - this.bufStart;
    this.pos += n;
    return this.buf.subarray(off, off + n);
  }

  async string() {
    const len = await this.u64();
    if (len > MAX_STRING) throw new GgufError('GGUF string is unreasonably long');
    return utf8(await this.bytes(len));
  }

  async skip(n: number) {
    // Skipping forward within or past the buffer: just move; ensure() refills from pos.
    const end = this.bufStart + this.buf.length;
    if (this.pos + n <= end) { this.pos += n; return; }
    this.pos += n;
    this.buf = new Uint8Array(0);
    this.bufStart = this.pos;
  }
}

function utf8(b: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  try { return decodeURIComponent(escape(s)); } catch { return s; }
}

const SCALAR_SIZE: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

async function readScalar(r: Reader, type: number): Promise<string | number | boolean> {
  switch (type) {
    case 0: return r.u8();
    case 1: return r.i8();
    case 2: return r.u16();
    case 3: return r.i16();
    case 4: return r.u32();
    case 5: return r.i32();
    case 6: return r.f32();
    case 7: return (await r.u8()) !== 0;
    case 8: return r.string();
    case 10: return r.u64();
    case 11: return r.i64();
    case 12: return r.f64();
    default: throw new GgufError(`Unknown GGUF metadata type ${type}`);
  }
}

async function skipArray(r: Reader) {
  const elemType = await r.u32();
  const count = await r.u64();
  if (elemType === 8) {
    for (let i = 0; i < count; i++) await r.skip(await r.u64());
  } else if (elemType === 9) {
    for (let i = 0; i < count; i++) await skipArray(r);
  } else {
    const size = SCALAR_SIZE[elemType];
    if (size === undefined) throw new GgufError(`Unknown GGUF array type ${elemType}`);
    await r.skip(size * count);
  }
}

export async function readGgufHeader(source: ByteSource): Promise<GgufHeader> {
  const r = new Reader(source);
  const magic = await r.bytes(4);
  if (String.fromCharCode(...magic) !== 'GGUF') throw new GgufError('Not a GGUF file');
  const version = await r.u32();
  if (version < 2 || version > 3) throw new GgufError(`Unsupported GGUF version ${version}`);
  const tensorCount = await r.u64();
  const kvCount = await r.u64();

  const metadata: Record<string, string | number | boolean> = {};
  for (let i = 0; i < kvCount; i++) {
    const key = await r.string();
    const type = await r.u32();
    if (type === 9) await skipArray(r);
    else metadata[key] = await readScalar(r, type);
  }

  const tensorTypes = new Map<number, number>();
  for (let i = 0; i < tensorCount; i++) {
    await r.skip(await r.u64()); // name
    const nDims = await r.u32();
    await r.skip(8 * nDims);
    const type = await r.u32();
    await r.skip(8); // offset
    tensorTypes.set(type, (tensorTypes.get(type) ?? 0) + 1);
  }
  return { version, tensorCount, metadata, tensorTypes };
}

export interface CompatibilityReport {
  ok: boolean;
  /** Names of tensor types this llama.cpp can't load. */
  unsupportedTypes: string[];
  /** Quant label from general.file_type, if present. */
  fileType: string | null;
}

export function checkCompatibility(h: GgufHeader): CompatibilityReport {
  const unsupportedTypes = [...h.tensorTypes.keys()]
    .filter((id) => GGML_TYPE_NAMES[id] === undefined)
    .sort((a, b) => a - b)
    .map(typeName);
  const ft = h.metadata['general.file_type'];
  return {
    ok: unsupportedTypes.length === 0,
    unsupportedTypes,
    fileType: typeof ft === 'number' ? (FILE_TYPE_NAMES[ft] ?? null) : null,
  };
}

/** Decode base64 to bytes (atob is available in React Native 0.74+ and Node 16+). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
