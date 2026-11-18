/**
 * Backup format: one JSON file with every chat, message, preset and setting,
 * plus model metadata and per-model settings (not the model files).
 *
 * Restoring replaces chats, presets and settings. Models are matched to the
 * ones already imported on this phone by file name and size; their settings
 * are restored onto those, and chats that used a model not on this phone keep
 * no model. Idea from DeepSeek's chat demo (src/services/chat/backup.ts, MIT,
 * Copyright (c) 2026 DeepSeek; full notice in lib/markdown.ts).
 */

export const BACKUP_FORMAT = 'llmchat-backup';
export const BACKUP_VERSION = 2;

type Row = Record<string, unknown>;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  settings: Row[];
  models: Row[];
  sessions: Row[];
  messages: Row[];
  presets: Row[];
}

export class BackupError extends Error {}

const TABLE_KEYS = ['settings', 'models', 'sessions', 'messages', 'presets'] as const;

/** Parse and sanity-check a backup file's text. */
export function parseBackup(text: string): Backup {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError("This file isn't a backup (not valid JSON).");
  }
  if (!data || data.format !== BACKUP_FORMAT) throw new BackupError("This file isn't a backup from this app.");
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of the app.');
  }
  for (const k of TABLE_KEYS) {
    if (!Array.isArray(data[k]) || data[k].some((r: unknown) => !r || typeof r !== 'object')) {
      throw new BackupError(`This backup is damaged (${k}).`);
    }
  }
  const ids = new Set(data.sessions.map((s: Row) => s.id));
  if (data.messages.some((m: Row) => !ids.has(m.sessionId))) {
    throw new BackupError('This backup is damaged (messages without a chat).');
  }
  return data as Backup;
}

/** Settings that describe this install rather than the user's choices. */
const LOCAL_SETTING_KEYS = new Set(['lastModelId']);

export function settingsToRestore(rows: Row[]): Row[] {
  return rows.filter((r) => typeof r.key === 'string' && !LOCAL_SETTING_KEYS.has(r.key));
}

const modelKey = (m: Row) => `${m.fileName}\u0000${m.fileSizeBytes}`;

/** Backup model id → id of the same file already on this phone (by file name and size). */
export function matchModels(backupModels: Row[], localModels: Row[]): Map<string, string> {
  const local = new Map(localModels.map((m) => [modelKey(m), String(m.id)]));
  const out = new Map<string, string>();
  for (const m of backupModels) {
    const id = local.get(modelKey(m));
    if (id) out.set(String(m.id), id);
  }
  return out;
}

/** Per-model choices restored onto a matched local model. */
export const MODEL_SETTING_COLUMNS = ['displayName', 'templateOverride', 'paramsOverride'] as const;

/**
 * INSERT for `row` into `table`, keeping only columns the table has (so older
 * and newer backups both restore).
 */
export function buildInsert(table: string, row: Row, columns: string[]): { sql: string; values: unknown[] } | null {
  const keys = Object.keys(row).filter((k) => columns.includes(k));
  if (keys.length === 0) return null;
  return {
    sql: `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    values: keys.map((k) => {
      const v = row[k];
      return v === undefined ? null : typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    }),
  };
}

export function backupFileName(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `llmchat-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function summarize(b: Backup): string {
  const chats = b.sessions.length;
  const date = new Date(b.exportedAt);
  const when = Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'an unknown date';
  return `${chats} chat${chats === 1 ? '' : 's'}, ${b.messages.length} message${b.messages.length === 1 ? '' : 's'}, from ${when}`;
}
