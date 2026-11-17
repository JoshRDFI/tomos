// Hugging Face downloads: start them in Android's DownloadManager, track
// them in the `downloads` table, and turn finished ones into models.
import * as db from './db';
import * as downloader from './downloader';
import type { DlInfo } from './downloader';
import { fileUrl, type GgufRow } from './hfApi';
import { finishModel } from './modelImport';
import type { DownloadPart, DownloadRecord, ModelRecord } from '@/types';

export type ReconcileAction =
  | { kind: 'finish'; download: DownloadRecord }
  | { kind: 'update'; id: string; patch: Partial<DownloadRecord> };

const MISSING_TEXT = "The download was removed from Android's download list.";
const UNREADABLE_TEXT = "This file isn't a readable GGUF model.";

/** DownloadManager COLUMN_REASON for a failed download → plain text. */
export function failureText(reason: number | null): string {
  switch (reason) {
    case 1006:
      return 'Not enough storage';
    case 1007:
      return 'The storage isn’t available.';
    case 1001:
    case 1009:
      return 'The file couldn’t be saved.';
    case 1004:
    case 1008:
      return 'The connection dropped and the download couldn’t continue.';
    case 401:
    case 403:
      return 'Hugging Face refused the download (it may need a login).';
    case 404:
      return 'The file is no longer on Hugging Face.';
  }
  if (reason != null && reason >= 400 && reason < 600) return `Hugging Face returned an error (${reason}).`;
  return 'The download failed.';
}

const basename = (p: string) => p.split('/').pop() ?? p;
const relativePath = (id: string, path: string) => `models/${id}/${basename(path)}`;
const partTitle = (label: string, n: number, of: number) => (of > 1 ? `${label} (part ${n}/${of})` : label);

/** Compare a download's parts with DownloadManager's view. Pure. */
export function reconcile(d: DownloadRecord, infos: DlInfo[]): ReconcileAction[] {
  const byId = new Map(infos.map((i) => [i.id, i]));
  let error: string | null = null;
  let changed = false;
  const parts: DownloadPart[] = d.parts.map((p) => {
    if (p.status !== 'active') return p;
    const info = byId.get(p.dmId);
    const status = info?.status ?? 'missing';
    if (status === 'succeeded') {
      changed = true;
      return { ...p, status: 'done' };
    }
    if (status === 'failed' || status === 'missing') {
      changed = true;
      error ??= status === 'missing' ? MISSING_TEXT : failureText(info?.reason ?? null);
      return { ...p, status: 'failed' };
    }
    return p;
  });
  if (!changed) return [];
  if (parts.every((p) => p.status === 'done')) return [{ kind: 'finish', download: { ...d, parts } }];
  if (error) return [{ kind: 'update', id: d.id, patch: { status: 'failed', error, parts } }];
  return [{ kind: 'update', id: d.id, patch: { parts } }];
}

export async function startDownload(o: { repo: string; sha: string; row: GgufRow; wifiOnly: boolean }): Promise<DownloadRecord> {
  const id = db.generateId();
  const { files, label } = o.row;
  const parts: DownloadPart[] = [];
  try {
    for (const [i, f] of files.entries()) {
      const dmId = await downloader.enqueue({
        url: fileUrl(o.repo, o.sha, f.path),
        relativePath: relativePath(id, f.path),
        title: partTitle(label, i + 1, files.length),
        wifiOnly: o.wifiOnly,
      });
      parts.push({ dmId, path: f.path, size: f.size, status: 'active' });
    }
  } catch (e) {
    if (parts.length) await downloader.remove(parts.map((p) => p.dmId)).catch(() => {});
    throw e;
  }
  const d: DownloadRecord = {
    id,
    repo: o.repo,
    revision: o.sha,
    fileName: basename(files[0].path),
    label,
    parts,
    totalBytes: o.row.totalBytes,
    status: 'active',
    wifiOnly: o.wifiOnly,
    createdAt: Date.now(),
    error: null,
  };
  await db.insertDownload(d);
  return d;
}

/** Re-queue failed parts from zero; finished parts are kept. */
export async function retryFailed(d: DownloadRecord): Promise<void> {
  const failed = d.parts.filter((p) => p.status === 'failed');
  // Drop the old entries (and any partial files) so the new ones can use the same names.
  if (failed.length) await downloader.remove(failed.map((p) => p.dmId)).catch(() => {});
  const parts: DownloadPart[] = [];
  for (const [i, p] of d.parts.entries()) {
    if (p.status !== 'failed') {
      parts.push(p);
      continue;
    }
    const dmId = await downloader.enqueue({
      url: fileUrl(d.repo, d.revision, p.path),
      relativePath: relativePath(d.id, p.path),
      title: partTitle(d.label, i + 1, d.parts.length),
      wifiOnly: d.wifiOnly,
    });
    parts.push({ ...p, dmId, status: 'active' });
  }
  await db.updateDownload(d.id, { status: 'active', error: null, parts });
}

function deleteFolder(id: string) {
  try {
    const { Directory } = require('expo-file-system') as typeof import('expo-file-system');
    const dir = new Directory(`file://${downloader.externalModelsDir()}/${id}`);
    if (dir.exists) dir.delete();
  } catch (e) {
    console.warn('Could not delete download folder', e);
  }
}

async function removeFiles(d: DownloadRecord) {
  await downloader.remove(d.parts.map((p) => p.dmId)).catch(() => {});
  deleteFolder(d.id);
}

export async function cancelDownload(d: DownloadRecord): Promise<void> {
  await removeFiles(d);
  await db.updateDownload(d.id, { status: 'cancelled' });
}

let running: Promise<{ finished: ModelRecord[]; failed: DownloadRecord[] }> | null = null;

/** Check active downloads and finish completed ones. Concurrent calls share one run. */
export function syncDownloads(): Promise<{ finished: ModelRecord[]; failed: DownloadRecord[] }> {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync() {
  const finished: ModelRecord[] = [];
  const failed: DownloadRecord[] = [];
  const active = (await db.getActiveDownloads()).filter((d) => d.status === 'active');
  if (!active.length) return { finished, failed };
  const infos = await downloader.query(active.flatMap((d) => d.parts.map((p) => p.dmId)));
  for (const d of active) {
    for (const a of reconcile(d, infos)) {
      if (a.kind === 'update') {
        await db.updateDownload(a.id, a.patch);
        if (a.patch.status === 'failed') failed.push({ ...d, ...a.patch });
        continue;
      }
      // Re-read: another sync (or an earlier app session) may have finished it already.
      const current = await db.getDownload(d.id);
      if (current?.status !== 'active') continue;
      await db.updateDownload(d.id, { status: 'done', parts: a.download.parts });
      const first = infos.find((i) => i.id === d.parts[0].dmId);
      const path = first?.localPath ?? `${downloader.externalModelsDir()}/${d.id}/${basename(d.parts[0].path)}`;
      try {
        finished.push(
          await finishModel({ id: d.id, fileName: d.label, filePath: `file://${path}`, fileSizeBytes: d.totalBytes, fileType: null })
        );
      } catch (e) {
        console.warn('Finishing download failed', e);
        await removeFiles(d);
        const patch = { status: 'failed' as const, error: UNREADABLE_TEXT };
        await db.updateDownload(d.id, patch);
        failed.push({ ...d, ...patch });
      }
    }
  }
  return { finished, failed };
}
