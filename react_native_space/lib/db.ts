import { Platform } from 'react-native';
import type { GenParams, ModelRecord, SessionRecord, MessageRecord, PromptPreset, SearchResult } from '@/types';
import { DEFAULT_GEN_PARAMS } from '@/types';
import { openDatabaseAsync } from './sqliteLoader';

let _db: any = null;

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateId(): string {
  return uuid();
}

export async function getDb() {
  if (_db) return _db;
  if (Platform.OS === 'web') return null;
  _db = await openDatabaseAsync('localchat.db');
  await _db.execAsync('PRAGMA journal_mode = WAL;');
  await _db.execAsync('PRAGMA foreign_keys = ON;');
  await createTables();
  return _db;
}

async function createTables() {
  const db = _db;
  if (!db) return;

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      fileSizeBytes INTEGER NOT NULL DEFAULT 0,
      quantization TEXT,
      architecture TEXT,
      parameterLabel TEXT,
      detectedTemplate TEXT,
      templateOverride TEXT NOT NULL DEFAULT 'auto',
      trainedContext INTEGER,
      addedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      modelId TEXT,
      systemPromptOverride TEXT,
      paramsOverride TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (modelId) REFERENCES models(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updatedAt DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      modelName TEXT,
      tokenCount INTEGER,
      tokensPerSec REAL,
      stopped INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      sessionId UNINDEXED,
      messageId UNINDEXED
    );

    CREATE TABLE IF NOT EXISTS prompt_presets (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  // FTS triggers
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(content, sessionId, messageId) VALUES (new.content, new.sessionId, new.id);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE messageId = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
      DELETE FROM messages_fts WHERE messageId = old.id;
      INSERT INTO messages_fts(content, sessionId, messageId) VALUES (new.content, new.sessionId, new.id);
    END;
  `);
}

// ── Settings ──

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync('SELECT value FROM settings WHERE key = ?', [key]);
  return (row as any)?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

export async function getDefaultParams(): Promise<GenParams> {
  const raw = await getSetting('defaultParams');
  if (!raw) return { ...DEFAULT_GEN_PARAMS };
  try { return { ...DEFAULT_GEN_PARAMS, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_GEN_PARAMS }; }
}

export async function getEffectiveParams(session: SessionRecord | null): Promise<GenParams> {
  if (session?.paramsOverride) {
    try { return { ...DEFAULT_GEN_PARAMS, ...JSON.parse(session.paramsOverride) }; } catch {}
  }
  return getDefaultParams();
}

export async function getEffectiveSystemPrompt(session: SessionRecord | null): Promise<string> {
  if (session?.systemPromptOverride != null) return session.systemPromptOverride;
  const v = await getSetting('defaultSystemPrompt');
  return v ?? 'You are a helpful, concise assistant.';
}

// ── Models ──

export async function getAllModels(): Promise<ModelRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAllAsync('SELECT * FROM models ORDER BY addedAt DESC')) as ModelRecord[];
}

export async function getModel(id: string): Promise<ModelRecord | null> {
  const db = await getDb();
  if (!db) return null;
  return ((await db.getFirstAsync('SELECT * FROM models WHERE id = ?', [id])) as ModelRecord) ?? null;
}

export async function insertModel(m: ModelRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `INSERT INTO models (id, displayName, fileName, filePath, fileSizeBytes, quantization, architecture, parameterLabel, detectedTemplate, templateOverride, trainedContext, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.id, m.displayName, m.fileName, m.filePath, m.fileSizeBytes, m.quantization, m.architecture, m.parameterLabel, m.detectedTemplate, m.templateOverride, m.trainedContext, m.addedAt]
  );
}

export async function updateModel(id: string, fields: Partial<ModelRecord>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const keys = Object.keys(fields).filter((k) => k !== 'id');
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => (fields as any)[k]);
  await db.runAsync(`UPDATE models SET ${sets} WHERE id = ?`, [...vals, id]);
}

export async function deleteModel(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM models WHERE id = ?', [id]);
}

// ── Sessions ──

export async function getAllSessions(): Promise<SessionRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAllAsync('SELECT * FROM sessions ORDER BY updatedAt DESC')) as SessionRecord[];
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const db = await getDb();
  if (!db) return null;
  return ((await db.getFirstAsync('SELECT * FROM sessions WHERE id = ?', [id])) as SessionRecord) ?? null;
}

export async function createSession(modelId: string | null): Promise<SessionRecord> {
  const db = await getDb();
  const now = Date.now();
  const s: SessionRecord = {
    id: uuid(),
    title: 'New chat',
    modelId,
    systemPromptOverride: null,
    paramsOverride: null,
    createdAt: now,
    updatedAt: now,
  };
  if (db) {
    await db.runAsync(
      'INSERT INTO sessions (id, title, modelId, systemPromptOverride, paramsOverride, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [s.id, s.title, s.modelId, s.systemPromptOverride, s.paramsOverride, s.createdAt, s.updatedAt]
    );
  }
  return s;
}

export async function updateSession(id: string, fields: Partial<SessionRecord>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const keys = Object.keys(fields).filter((k) => k !== 'id');
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => (fields as any)[k]);
  await db.runAsync(`UPDATE sessions SET ${sets} WHERE id = ?`, [...vals, id]);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM sessions WHERE id = ?', [id]);
}

// ── Messages ──

export async function getSessionMessages(sessionId: string): Promise<MessageRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAllAsync('SELECT * FROM messages WHERE sessionId = ? ORDER BY createdAt ASC', [sessionId])) as MessageRecord[];
}

export async function insertMessage(m: MessageRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO messages (id, sessionId, role, content, modelName, tokenCount, tokensPerSec, stopped, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [m.id, m.sessionId, m.role, m.content, m.modelName, m.tokenCount, m.tokensPerSec, m.stopped, m.createdAt]
  );
}

export async function updateMessage(id: string, fields: Partial<MessageRecord>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const keys = Object.keys(fields).filter((k) => k !== 'id');
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => (fields as any)[k]);
  await db.runAsync(`UPDATE messages SET ${sets} WHERE id = ?`, [...vals, id]);
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM messages WHERE id = ?', [id]);
}

export async function deleteMessagesAfter(sessionId: string, createdAt: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM messages WHERE sessionId = ? AND createdAt > ?', [sessionId, createdAt]);
}

export async function getSessionMessageCount(sessionId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const row = await db.getFirstAsync('SELECT COUNT(*) as cnt FROM messages WHERE sessionId = ?', [sessionId]);
  return (row as any)?.cnt ?? 0;
}

// ── Search ──

export async function searchMessages(query: string): Promise<SearchResult[]> {
  const db = await getDb();
  if (!db) return [];
  const term = query.replace(/["*]/g, '') + '*';
  const rows = await db.getAllAsync(
    `SELECT f.messageId, f.sessionId, s.title as sessionTitle, m.content, m.role, m.createdAt,
       snippet(messages_fts, 0, '<<', '>>', '...', 40) as snippet
     FROM messages_fts f
     JOIN messages m ON m.id = f.messageId
     JOIN sessions s ON s.id = f.sessionId
     WHERE messages_fts MATCH ?
     ORDER BY m.createdAt DESC LIMIT 100`,
    [term]
  );
  return (rows ?? []) as SearchResult[];
}

// ── Presets ──

export async function getAllPresets(): Promise<PromptPreset[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAllAsync('SELECT * FROM prompt_presets ORDER BY createdAt DESC')) as PromptPreset[];
}

export async function insertPreset(p: PromptPreset): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('INSERT INTO prompt_presets (id, name, content, createdAt) VALUES (?, ?, ?, ?)', [p.id, p.name, p.content, p.createdAt]);
}

export async function updatePreset(id: string, fields: Partial<PromptPreset>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const keys = Object.keys(fields).filter((k) => k !== 'id');
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => (fields as any)[k]);
  await db.runAsync(`UPDATE prompt_presets SET ${sets} WHERE id = ?`, [...vals, id]);
}

export async function deletePreset(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM prompt_presets WHERE id = ?', [id]);
}

export async function presetNameExists(name: string, excludeId?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row = excludeId
    ? await db.getFirstAsync('SELECT 1 FROM prompt_presets WHERE name = ? AND id != ?', [name, excludeId])
    : await db.getFirstAsync('SELECT 1 FROM prompt_presets WHERE name = ?', [name]);
  return !!row;
}
