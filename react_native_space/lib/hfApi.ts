// Minimal Hugging Face Hub client: a repo's files, GGUF versions of a base
// model, and byte-range reads for the GGUF header check. Anonymous only.
import { isPrismOnlyQuant, parseQuantFromFilename } from './gguf';

const HUB = 'https://huggingface.co';

export interface HfRepoInfo {
  id: string;
  sha: string;
  gated: boolean;
  siblings: { rfilename: string; size: number }[];
}

export interface GgufRow {
  key: string;
  label: string;
  files: { path: string; size: number }[];
  totalBytes: number;
  quant: string | null;
  prism: boolean;
}

export interface QuantizedRepo {
  id: string;
  downloads: number;
  likes: number;
}

export type HfErrorKind = 'not_found' | 'gated' | 'network' | 'http';

export class HfError extends Error {
  kind: HfErrorKind;
  constructor(kind: HfErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'HfError';
  }
}

async function get(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new HfError('network', String((e as any)?.message ?? e));
  }
}

export async function fetchRepo(repo: string): Promise<HfRepoInfo> {
  const res = await get(`${HUB}/api/models/${repo}?blobs=true`);
  // Anonymous requests get 401 for private and nonexistent repos alike.
  if (res.status === 401 || res.status === 404) throw new HfError('not_found', `No public model at ${repo}`);
  if (!res.ok) throw new HfError('http', `Hugging Face returned ${res.status}`);
  const d = await res.json();
  // Gated repos list their files but refuse the downloads.
  if (d.gated !== false && d.gated != null) throw new HfError('gated', `${repo} needs a Hugging Face login`);
  return {
    id: d.id,
    sha: d.sha,
    gated: false,
    siblings: (d.siblings ?? []).map((s: any) => ({ rfilename: s.rfilename, size: Number(s.size ?? 0) })),
  };
}

export async function fetchQuantizedRepos(baseRepo: string): Promise<QuantizedRepo[]> {
  const q = `filter=${encodeURIComponent(`base_model:quantized:${baseRepo}`)}&filter=gguf&sort=downloads&direction=-1&limit=20`;
  const res = await get(`${HUB}/api/models?${q}`);
  if (!res.ok) throw new HfError('http', `Hugging Face returned ${res.status}`);
  const d: any[] = await res.json();
  return d.map((r) => ({ id: r.id, downloads: Number(r.downloads ?? 0), likes: Number(r.likes ?? 0) }));
}

const SPLIT_RE = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i;

export function ggufRows(siblings: HfRepoInfo['siblings']): GgufRow[] {
  const single: GgufRow[] = [];
  const splits = new Map<string, { of: number; parts: Map<number, { path: string; size: number }> }>();
  for (const s of siblings) {
    const path = s.rfilename;
    const base = path.split('/').pop() ?? path;
    if (!/\.gguf$/i.test(base) || /mmproj/i.test(path)) continue;
    const m = path.match(SPLIT_RE);
    if (m) {
      const key = m[1];
      const entry = splits.get(key) ?? { of: Number(m[3]), parts: new Map() };
      entry.parts.set(Number(m[2]), { path, size: s.size });
      splits.set(key, entry);
    } else {
      single.push(row(path, base, [{ path, size: s.size }]));
    }
  }
  for (const [key, { of, parts }] of splits) {
    if (parts.size !== of) continue;
    const files = [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f);
    single.push(row(key, `${key.split('/').pop()}.gguf`, files));
  }
  return single.sort((a, b) => a.totalBytes - b.totalBytes);
}

function row(key: string, label: string, files: { path: string; size: number }[]): GgufRow {
  const quant = parseQuantFromFilename(label);
  return { key, label, files, totalBytes: files.reduce((n, f) => n + f.size, 0), quant, prism: isPrismOnlyQuant(quant) };
}

export function fileUrl(repo: string, sha: string, path: string): string {
  return `${HUB}/${repo}/resolve/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function rangeReader(url: string): (offset: number, length: number) => Promise<Uint8Array> {
  return async (offset, length) => {
    const res = await get(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (!res.ok) throw new HfError('http', `Hugging Face returned ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return res.status === 206 ? bytes : bytes.slice(offset, offset + length);
  };
}
