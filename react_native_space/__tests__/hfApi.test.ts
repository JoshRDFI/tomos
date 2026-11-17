import { fetchQuantizedRepos, fetchRepo, fileUrl, ggufRows, HfError, rangeReader } from '../lib/hfApi';

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response);

afterEach(() => {
  (global as any).fetch = undefined;
});

describe('ggufRows', () => {
  const siblings = [
    { rfilename: 'README.md', size: 1 },
    { rfilename: 'Qwen3-8B-Q4_K_M.gguf', size: 5027784512 },
    { rfilename: 'mmproj-F16.gguf', size: 5 },
    { rfilename: 'mmproj/x.gguf', size: 5 },
    { rfilename: 'BF16/R-BF16-00002-of-00002.gguf', size: 20 },
    { rfilename: 'BF16/R-BF16-00001-of-00002.gguf', size: 10 },
  ];

  it('keeps GGUF files, hides mmproj, groups split parts, sorts by size', () => {
    const rows = ggufRows(siblings);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      label: 'R-BF16.gguf',
      totalBytes: 30,
      files: [{ path: 'BF16/R-BF16-00001-of-00002.gguf', size: 10 }, { path: 'BF16/R-BF16-00002-of-00002.gguf', size: 20 }],
    });
    expect(rows[1]).toMatchObject({ label: 'Qwen3-8B-Q4_K_M.gguf', quant: 'Q4_K_M', prism: false, totalBytes: 5027784512 });
  });

  it('drops a split set with a missing part', () => {
    expect(ggufRows([
      { rfilename: 'M-00001-of-00003.gguf', size: 1 },
      { rfilename: 'M-00003-of-00003.gguf', size: 1 },
    ])).toEqual([]);
  });

  it('flags PrismML-only quants', () => {
    expect(ggufRows([{ rfilename: 'Bonsai-8B-PQ2_0.gguf', size: 1 }])[0].prism).toBe(true);
  });
});

describe('fileUrl', () => {
  it('encodes each path segment and keeps folders', () => {
    expect(fileUrl('u/r', 'abc', 'BF16/a b.gguf')).toBe('https://huggingface.co/u/r/resolve/abc/BF16/a%20b.gguf');
  });
});

describe('fetchRepo', () => {
  it('returns the repo with blobs requested', async () => {
    const fetch = jest.fn(() => json(200, { id: 'u/r', sha: 's1', gated: false, siblings: [{ rfilename: 'a.gguf', size: 3 }], tags: [] }));
    (global as any).fetch = fetch;
    await expect(fetchRepo('u/r')).resolves.toEqual({ id: 'u/r', sha: 's1', gated: false, siblings: [{ rfilename: 'a.gguf', size: 3 }] });
    expect((fetch.mock.calls[0] as any[])[0]).toBe('https://huggingface.co/api/models/u/r?blobs=true');
  });

  it('treats 401 as not found (anonymous API hides private repos)', async () => {
    (global as any).fetch = jest.fn(() => json(401, {}));
    await expect(fetchRepo('nobody/nothing')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('reports gated repos even though their file list loads', async () => {
    (global as any).fetch = jest.fn(() => json(200, { id: 'm/l', sha: 's', gated: 'manual', siblings: [] }));
    const err = await fetchRepo('m/l').catch((e) => e);
    expect(err).toBeInstanceOf(HfError);
    expect(err.kind).toBe('gated');
  });

  it('reports network failures', async () => {
    (global as any).fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(fetchRepo('u/r')).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('fetchQuantizedRepos', () => {
  it('asks for GGUF repos quantized from the base, by downloads', async () => {
    const fetch = jest.fn(() => json(200, [{ id: 'Qwen/Qwen3-8B-GGUF', downloads: 845664, likes: 400, tags: [] }]));
    (global as any).fetch = fetch;
    await expect(fetchQuantizedRepos('Qwen/Qwen3-8B')).resolves.toEqual([{ id: 'Qwen/Qwen3-8B-GGUF', downloads: 845664, likes: 400 }]);
    const url = decodeURIComponent((fetch.mock.calls[0] as any[])[0]);
    expect(url).toContain('filter=base_model:quantized:Qwen/Qwen3-8B');
    expect(url).toContain('filter=gguf');
    expect(url).toContain('sort=downloads');
  });
});

describe('rangeReader', () => {
  const bytes = Uint8Array.from({ length: 200 }, (_, i) => i);

  it('requests the byte range', async () => {
    const fetch = jest.fn(() => Promise.resolve({ ok: true, status: 206, arrayBuffer: () => Promise.resolve(bytes.slice(100, 150).buffer) } as unknown as Response));
    (global as any).fetch = fetch;
    const out = await rangeReader('https://x/f.gguf')(100, 50);
    expect((fetch.mock.calls[0] as any[])[1].headers.Range).toBe('bytes=100-149');
    expect(Array.from(out)).toEqual(Array.from(bytes.slice(100, 150)));
  });

  it('slices when the server ignores Range', async () => {
    (global as any).fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response));
    const out = await rangeReader('https://x/f.gguf')(100, 50);
    expect(Array.from(out)).toEqual(Array.from(bytes.slice(100, 150)));
  });
});
