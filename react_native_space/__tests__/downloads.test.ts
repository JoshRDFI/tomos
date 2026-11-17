jest.mock('../lib/db', () => ({
  generateId: jest.fn(() => 'd1'),
  insertDownload: jest.fn(() => Promise.resolve()),
  updateDownload: jest.fn(() => Promise.resolve()),
  getDownload: jest.fn(),
  getActiveDownloads: jest.fn(),
}));
jest.mock('../lib/downloader', () => ({
  enqueue: jest.fn(),
  query: jest.fn(),
  remove: jest.fn(() => Promise.resolve()),
  externalModelsDir: jest.fn(() => '/ext/files/models'),
}));
jest.mock('../lib/modelImport', () => ({ finishModel: jest.fn() }));
const mockDirDelete = jest.fn();
jest.mock('expo-file-system', () => ({
  Directory: jest.fn().mockImplementation((uri: string) => ({ uri, exists: true, delete: () => mockDirDelete(uri) })),
}));

import * as db from '../lib/db';
import * as downloader from '../lib/downloader';
import { finishModel } from '../lib/modelImport';
import { cancelDownload, failureText, reconcile, retryFailed, startDownload, syncDownloads } from '../lib/downloads';
import type { DownloadRecord } from '../types';
import type { DlInfo } from '../lib/downloader';

const m = {
  getDownload: db.getDownload as jest.Mock,
  getActive: db.getActiveDownloads as jest.Mock,
  update: db.updateDownload as jest.Mock,
  insert: db.insertDownload as jest.Mock,
  enqueue: downloader.enqueue as jest.Mock,
  query: downloader.query as jest.Mock,
  remove: downloader.remove as jest.Mock,
  finish: finishModel as jest.Mock,
};

const rec = (over: Partial<DownloadRecord> = {}): DownloadRecord => ({
  id: 'd1',
  repo: 'u/r',
  revision: 'sha1',
  fileName: 'R-BF16-00001-of-00002.gguf',
  label: 'R-BF16.gguf',
  parts: [
    { dmId: 11, path: 'BF16/R-BF16-00001-of-00002.gguf', size: 10, status: 'active' },
    { dmId: 12, path: 'BF16/R-BF16-00002-of-00002.gguf', size: 20, status: 'active' },
  ],
  totalBytes: 30,
  status: 'active',
  wifiOnly: true,
  createdAt: 1,
  error: null,
  ...over,
});

const info = (id: number, status: DlInfo['status'], reason: number | null = null): DlInfo => ({
  id,
  status,
  bytesSoFar: 0,
  totalBytes: 0,
  reason,
  localPath: status === 'succeeded' ? `/ext/files/models/d1/part${id}.gguf` : null,
});

beforeEach(() => jest.clearAllMocks());

describe('failureText', () => {
  it('names the common DownloadManager errors', () => {
    expect(failureText(1006)).toBe('Not enough storage');
    expect(failureText(404)).toMatch(/no longer on Hugging Face/);
    expect(failureText(null)).toBe('The download failed.');
  });
});

describe('reconcile', () => {
  it('finishes when every part succeeded', () => {
    const out = reconcile(rec(), [info(11, 'succeeded'), info(12, 'succeeded')]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('finish');
  });

  it('marks the record failed when one part failed and keeps the finished one', () => {
    const out = reconcile(rec(), [info(11, 'succeeded'), info(12, 'failed', 1006)]);
    expect(out).toEqual([
      {
        kind: 'update',
        id: 'd1',
        patch: {
          status: 'failed',
          error: 'Not enough storage',
          parts: [expect.objectContaining({ dmId: 11, status: 'done' }), expect.objectContaining({ dmId: 12, status: 'failed' })],
        },
      },
    ]);
  });

  it('treats a part that vanished from the download list as failed', () => {
    const out = reconcile(rec(), [info(11, 'running'), info(12, 'missing')]);
    expect(out[0]).toMatchObject({ kind: 'update', patch: { status: 'failed', error: "The download was removed from Android's download list." } });
  });

  it('leaves running, pending and paused downloads alone', () => {
    expect(reconcile(rec(), [info(11, 'running'), info(12, 'paused', 3)])).toEqual([]);
    expect(reconcile(rec(), [info(11, 'pending'), info(12, 'running')])).toEqual([]);
  });

  it('records a finished part while another is still running', () => {
    const out = reconcile(rec(), [info(11, 'succeeded'), info(12, 'running')]);
    expect(out).toEqual([{ kind: 'update', id: 'd1', patch: { parts: [expect.objectContaining({ status: 'done' }), expect.objectContaining({ status: 'active' })] } }]);
  });
});

describe('startDownload', () => {
  it('queues each part into models/<id>/ with part titles', async () => {
    m.enqueue.mockResolvedValueOnce(101).mockResolvedValueOnce(102);
    const row = { key: 'BF16/R-BF16', label: 'R-BF16.gguf', files: rec().parts.map(({ path, size }) => ({ path, size })), totalBytes: 30, quant: 'BF16', prism: false };
    const d = await startDownload({ repo: 'u/r', sha: 'sha1', row, wifiOnly: true });
    expect(m.enqueue).toHaveBeenNthCalledWith(1, {
      url: 'https://huggingface.co/u/r/resolve/sha1/BF16/R-BF16-00001-of-00002.gguf',
      relativePath: 'models/d1/R-BF16-00001-of-00002.gguf',
      title: 'R-BF16.gguf (part 1/2)',
      wifiOnly: true,
    });
    expect(d.parts.map((p) => p.dmId)).toEqual([101, 102]);
    expect(d).toMatchObject({ status: 'active', revision: 'sha1', totalBytes: 30, label: 'R-BF16.gguf' });
    expect(m.insert).toHaveBeenCalledWith(d);
  });
});

describe('retryFailed', () => {
  it('re-queues only the failed parts and reactivates the record', async () => {
    m.enqueue.mockResolvedValueOnce(200);
    const d = rec({
      status: 'failed',
      error: 'Not enough storage',
      parts: [
        { dmId: 11, path: 'BF16/R-BF16-00001-of-00002.gguf', size: 10, status: 'done' },
        { dmId: 12, path: 'BF16/R-BF16-00002-of-00002.gguf', size: 20, status: 'failed' },
      ],
    });
    await retryFailed(d);
    expect(m.remove).toHaveBeenCalledWith([12]);
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][0]).toMatchObject({ relativePath: 'models/d1/R-BF16-00002-of-00002.gguf', wifiOnly: true });
    expect(m.update).toHaveBeenCalledWith('d1', {
      status: 'active',
      error: null,
      parts: [expect.objectContaining({ dmId: 11, status: 'done' }), expect.objectContaining({ dmId: 200, status: 'active' })],
    });
  });
});

describe('cancelDownload', () => {
  it('removes every part, the folder, and marks it cancelled', async () => {
    await cancelDownload(rec());
    expect(m.remove).toHaveBeenCalledWith([11, 12]);
    expect(mockDirDelete).toHaveBeenCalledWith('file:///ext/files/models/d1');
    expect(m.update).toHaveBeenCalledWith('d1', { status: 'cancelled' });
  });
});

describe('syncDownloads', () => {
  it('creates the model from the first part once all parts finish', async () => {
    m.getActive.mockResolvedValue([rec()]);
    m.query.mockResolvedValue([info(11, 'succeeded'), info(12, 'succeeded')]);
    m.getDownload.mockResolvedValue(rec());
    m.finish.mockResolvedValue({ id: 'd1' });
    const out = await syncDownloads();
    expect(m.finish).toHaveBeenCalledWith({
      id: 'd1',
      fileName: 'R-BF16.gguf',
      filePath: 'file:///ext/files/models/d1/part11.gguf',
      fileSizeBytes: 30,
      fileType: null,
    });
    expect(m.update).toHaveBeenCalledWith('d1', expect.objectContaining({ status: 'done' }));
    expect(out.finished).toEqual([{ id: 'd1' }]);
  });

  it('does not finish a download a previous sync already finished', async () => {
    m.getActive.mockResolvedValue([rec()]);
    m.query.mockResolvedValue([info(11, 'succeeded'), info(12, 'succeeded')]);
    m.getDownload.mockResolvedValue(rec({ status: 'done' }));
    await syncDownloads();
    expect(m.finish).not.toHaveBeenCalled();
  });

  it('shares one run when called twice at once', async () => {
    m.getActive.mockResolvedValue([rec()]);
    m.query.mockResolvedValue([info(11, 'succeeded'), info(12, 'succeeded')]);
    m.getDownload.mockResolvedValue(rec());
    m.finish.mockResolvedValue({ id: 'd1' });
    await Promise.all([syncDownloads(), syncDownloads()]);
    expect(m.finish).toHaveBeenCalledTimes(1);
  });

  it('fails the download and removes its files when the file is not a usable model', async () => {
    m.getActive.mockResolvedValue([rec()]);
    m.query.mockResolvedValue([info(11, 'succeeded'), info(12, 'succeeded')]);
    m.getDownload.mockResolvedValue(rec());
    m.finish.mockRejectedValue(new Error('bad'));
    const out = await syncDownloads();
    expect(m.remove).toHaveBeenCalledWith([11, 12]);
    expect(mockDirDelete).toHaveBeenCalledWith('file:///ext/files/models/d1');
    expect(m.update).toHaveBeenLastCalledWith('d1', { status: 'failed', error: "This file isn't a readable GGUF model." });
    expect(out.failed).toHaveLength(1);
  });

  it('only reconciles active downloads', async () => {
    m.getActive.mockResolvedValue([rec({ status: 'failed' })]);
    await syncDownloads();
    expect(m.query).not.toHaveBeenCalled();
  });
});
