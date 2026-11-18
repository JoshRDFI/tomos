import { Platform } from 'react-native';
import type { DownloadRecord, ModelRecord, SessionRecord, MessageRecord, Persona, PersonaExample, SearchResult, Summary } from '@/types';
import { activeSummary } from './compaction';
import { completionParamsOnly, isChatEmpty, linkExactCopies, pickDefaultPersona, resolveInstructions } from './personas';
import { composeSystemMessage } from './prompt';
import { LEGACY_DEFAULTS, parseParamSet, resolveParams, serializeParamSet, type ParamSet, type ResolvedParams } from './params';
import { openDatabaseAsync } from './sqliteLoader';
import { buildFtsQuery } from './fts';
import { linearLinks, pathTo, versionsOf, visiblePath } from './branches';
import { BACKUP_FORMAT, BACKUP_VERSION, MODEL_SETTING_COLUMNS, buildInsert, matchModels, settingsToRestore, type Backup } from './backup';

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

let _dbReady: Promise<any> | null = null;

/** The database, once tables and migrations are in place (null on web). */
export async function getDb() {
  if (Platform.OS === 'web') return null;
  _dbReady ??= (async () => {
    _db = await openDatabaseAsync('localchat.db');
    await _db.execAsync('PRAGMA journal_mode = WAL;');
    await _db.execAsync('PRAGMA foreign_keys = ON;');
    await createTables();
    return _db;
  })().catch((e) => {
    _dbReady = null;
    throw e;
  });
  return _dbReady;
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

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      throughMessageId TEXT NOT NULL,
      content TEXT NOT NULL,
      tokenCount INTEGER,
      modelName TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(sessionId);

    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      revision TEXT NOT NULL,
      fileName TEXT NOT NULL,
      label TEXT NOT NULL,
      parts TEXT NOT NULL,
      totalBytes INTEGER NOT NULL,
      status TEXT NOT NULL,
      wifiOnly INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      error TEXT
    );
  `);

  // Columns added after the first release
  const modelCols = ((await db.getAllAsync('PRAGMA table_info(models)')) as { name: string }[]).map((c) => c.name);
  if (!modelCols.includes('fileParams')) await db.execAsync('ALTER TABLE models ADD COLUMN fileParams TEXT');
  if (!modelCols.includes('paramsOverride')) await db.execAsync('ALTER TABLE models ADD COLUMN paramsOverride TEXT');
  const msgCols = ((await db.getAllAsync('PRAGMA table_info(messages)')) as { name: string }[]).map((c) => c.name);
  if (!msgCols.includes('reasoning')) await db.execAsync('ALTER TABLE messages ADD COLUMN reasoning TEXT');
  if (!msgCols.includes('thinkingMs')) await db.execAsync('ALTER TABLE messages ADD COLUMN thinkingMs INTEGER');
  if (!msgCols.includes('parentId')) await migrateToBranches(db);
  if (!msgCols.includes('kind')) await db.execAsync('ALTER TABLE messages ADD COLUMN kind TEXT');
  const presetCols = ((await db.getAllAsync('PRAGMA table_info(prompt_presets)')) as { name: string }[]).map((c) => c.name);
  for (const [col, type] of [['greeting', 'TEXT'], ['examples', 'TEXT'], ['params', 'TEXT'], ['updatedAt', 'INTEGER']] as const) {
    if (!presetCols.includes(col)) await db.execAsync(`ALTER TABLE prompt_presets ADD COLUMN ${col} ${type}`);
  }
  const sessionCols = ((await db.getAllAsync('PRAGMA table_info(sessions)')) as { name: string }[]).map((c) => c.name);
  if (!sessionCols.includes('personaId')) await migrateToPersonas(db);
  if (!sessionCols.includes('continuedFromId')) await db.execAsync('ALTER TABLE sessions ADD COLUMN continuedFromId TEXT');
  if (!sessionCols.includes('carryOver')) await db.execAsync('ALTER TABLE sessions ADD COLUMN carryOver TEXT');

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

/**
 * Presets become personas. Chats (and the default prompt) whose text is an
 * exact copy of a preset are linked to it; the text the model sees is the same.
 */
async function migrateToPersonas(db: any) {
  await db.withExclusiveTransactionAsync(async (tx: any) => {
    await tx.execAsync('ALTER TABLE sessions ADD COLUMN personaId TEXT');
    const presets = (await tx.getAllAsync('SELECT id, content, createdAt FROM prompt_presets')) as { id: string; content: string; createdAt: number }[];
    const sessions = (await tx.getAllAsync('SELECT id, systemPromptOverride FROM sessions')) as { id: string; systemPromptOverride: string | null }[];
    const def = (await tx.getFirstAsync("SELECT value FROM settings WHERE key = 'defaultSystemPrompt'")) as { value: string | null } | null;
    const links = linkExactCopies(presets, sessions, def?.value ?? null);
    for (const l of links.sessionLinks) {
      await tx.runAsync('UPDATE sessions SET personaId = ?, systemPromptOverride = NULL WHERE id = ?', [l.personaId, l.sessionId]);
    }
    if (links.defaultPersonaId) {
      await tx.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('defaultPersonaId', ?)", [links.defaultPersonaId]);
    }
  });
}

/**
 * Add message branches. Existing chats become a single branch: each message's
 * parent is the one before it. Runs once, in one transaction, so a crash
 * can't leave half-linked chats.
 */
async function migrateToBranches(db: any) {
  await db.withExclusiveTransactionAsync(async (tx: any) => {
    await tx.execAsync('ALTER TABLE messages ADD COLUMN parentId TEXT');
    await tx.execAsync('ALTER TABLE messages ADD COLUMN selectedChildId TEXT');
    const sessCols = ((await tx.getAllAsync('PRAGMA table_info(sessions)')) as { name: string }[]).map((c) => c.name);
    if (!sessCols.includes('rootMessageId')) await tx.execAsync('ALTER TABLE sessions ADD COLUMN rootMessageId TEXT');
    const rows = (await tx.getAllAsync('SELECT id, sessionId, createdAt FROM messages ORDER BY sessionId, createdAt, rowid')) as { id: string; sessionId: string; createdAt: number }[];
    const bySession = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = bySession.get(r.sessionId);
      if (list) list.push(r);
      else bySession.set(r.sessionId, [r]);
    }
    for (const [sessionId, list] of bySession) {
      for (const l of linearLinks(list)) {
        await tx.runAsync('UPDATE messages SET parentId = ?, selectedChildId = ? WHERE id = ?', [l.parentId, l.selectedChildId, l.id]);
      }
      await tx.runAsync('UPDATE sessions SET rootMessageId = ? WHERE id = ?', [list[0]!.id, sessionId]);
    }
  });
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parentId)');
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

/** Settings for all chats ("All chats" layer). */
export async function getGlobalParams(): Promise<ParamSet> {
  const raw = await getSetting('globalParams');
  if (raw != null) return parseParamSet(raw);
  // The first app version stored a full set of 8 values under 'defaultParams'
  // whenever any slider moved. Keep only the ones that differ from that
  // version's defaults, so untouched values don't show up as customized.
  const legacy = parseParamSet(await getSetting('defaultParams'));
  for (const [k, v] of Object.entries(legacy)) {
    if (LEGACY_DEFAULTS[k] === v) delete legacy[k];
  }
  return legacy;
}

export async function setGlobalParams(set: ParamSet): Promise<void> {
  await setSetting('globalParams', serializeParamSet(set) ?? '{}');
}

/**
 * Effective settings for generating in `session` with `model`:
 * app defaults < all chats < model file < this model < this chat.
 */
export async function getEffectiveParams(session: SessionRecord | null, model: ModelRecord | null): Promise<ResolvedParams> {
  const source = resolveInstructions(session, session?.personaId ? await getAllPersonas() : [], '');
  return resolveParams({
    global: await getGlobalParams(),
    file: parseParamSet(model?.fileParams),
    model: parseParamSet(model?.paramsOverride),
    persona: source.kind === 'persona' ? completionParamsOnly(source.persona.params) : undefined,
    chat: parseParamSet(session?.paramsOverride),
  });
}

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful, concise assistant.';

/**
 * The system message for a chat at `path`: its instructions (custom, persona
 * or default), the date, the persona's examples. Every request for this chat
 * builds it here, so the chat and its summaries share a prompt prefix.
 */
export async function buildSystemMessage(session: SessionRecord | null, path: MessageRecord[]): Promise<string> {
  const summary = session ? activeSummary(await getSummaries(session.id), path) : null;
  const greeting = path[0]?.kind === 'greeting' ? path[0].content : null;
  const source = resolveInstructions(session, await getAllPersonas(), (await getSetting('defaultSystemPrompt')) ?? DEFAULT_SYSTEM_PROMPT);
  const instructions = source.kind === 'persona' ? source.persona.content : source.text;
  return composeSystemMessage({
    instructions,
    date: (await getSetting('includeDate')) !== '0' ? new Date() : null,
    examples: source.kind === 'persona' ? source.persona.examples : [],
    greeting,
    summary: summary?.content ?? null,
    carryOver: session?.carryOver ?? null,
  });
}

// ── Summaries (auto-compaction) ──

export async function getSummaries(sessionId: string): Promise<Summary[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAllAsync('SELECT * FROM summaries WHERE sessionId = ? ORDER BY createdAt ASC', [sessionId])) as Summary[];
}

export async function insertSummary(s: Summary): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO summaries (id, sessionId, throughMessageId, content, tokenCount, modelName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [s.id, s.sessionId, s.throughMessageId, s.content, s.tokenCount, s.modelName, s.createdAt],
  );
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
    `INSERT INTO models (id, displayName, fileName, filePath, fileSizeBytes, quantization, architecture, parameterLabel, detectedTemplate, templateOverride, trainedContext, addedAt, fileParams, paramsOverride)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.id, m.displayName, m.fileName, m.filePath, m.fileSizeBytes, m.quantization, m.architecture, m.parameterLabel, m.detectedTemplate, m.templateOverride, m.trainedContext, m.addedAt, m.fileParams, m.paramsOverride]
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

// ── Downloads (Hugging Face; not part of backups) ──

function rowToDownload(r: any): DownloadRecord {
  return { ...r, parts: JSON.parse(r.parts), wifiOnly: !!r.wifiOnly };
}

export async function insertDownload(d: DownloadRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `INSERT INTO downloads (id, repo, revision, fileName, label, parts, totalBytes, status, wifiOnly, createdAt, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.id, d.repo, d.revision, d.fileName, d.label, JSON.stringify(d.parts), d.totalBytes, d.status, d.wifiOnly ? 1 : 0, d.createdAt, d.error]
  );
}

/** With `onlyIfStatus`, the write applies only while the row still has that status. */
export async function updateDownload(id: string, patch: Partial<DownloadRecord>, onlyIfStatus?: DownloadRecord['status']): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const keys = Object.keys(patch).filter((k) => k !== 'id');
  if (keys.length === 0) return;
  const vals = keys.map((k) => {
    const v = (patch as any)[k];
    return k === 'parts' ? JSON.stringify(v) : k === 'wifiOnly' ? (v ? 1 : 0) : v;
  });
  const where = onlyIfStatus ? 'id = ? AND status = ?' : 'id = ?';
  await db.runAsync(`UPDATE downloads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${where}`, [...vals, id, ...(onlyIfStatus ? [onlyIfStatus] : [])]);
}

export async function getDownload(id: string): Promise<DownloadRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const r = await db.getFirstAsync('SELECT * FROM downloads WHERE id = ?', [id]);
  return r ? rowToDownload(r) : null;
}

/** Downloads still worth showing: in progress or failed (awaiting Retry/Cancel). */
export async function getActiveDownloads(): Promise<DownloadRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync("SELECT * FROM downloads WHERE status IN ('active', 'failed') ORDER BY createdAt");
  return (rows as any[]).map(rowToDownload);
}

export async function deleteDownload(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('DELETE FROM downloads WHERE id = ?', [id]);
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

/**
 * A new chat. Without `opts.personaId` it starts with the default persona from
 * Settings (applied now, so changing the default later leaves it alone), and
 * with that persona's greeting.
 */
export async function createSession(modelId: string | null, opts?: { personaId?: string | null }): Promise<SessionRecord> {
  const db = await getDb();
  const now = Date.now();
  const personas = await getAllPersonas();
  const persona = opts?.personaId !== undefined
    ? (opts.personaId ? (personas.find((p) => p.id === opts.personaId) ?? null) : null)
    : pickDefaultPersona(await getSetting('defaultPersonaId'), personas);
  const s: SessionRecord = {
    id: uuid(),
    title: 'New chat',
    modelId,
    systemPromptOverride: null,
    paramsOverride: null,
    personaId: persona?.id ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (db) {
    await db.runAsync(
      'INSERT INTO sessions (id, title, modelId, systemPromptOverride, paramsOverride, personaId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [s.id, s.title, s.modelId, s.systemPromptOverride, s.paramsOverride, s.personaId, s.createdAt, s.updatedAt]
    );
    if (persona?.greeting) await insertGreeting(s.id, persona);
  }
  return s;
}

/**
 * "Continue in a new chat": a new chat that behaves like `from` (model,
 * persona or custom text, settings), starts with `carryOver`, and links back.
 * No greeting: the conversation is already under way.
 */
export async function createContinuation(from: SessionRecord, carryOver: string): Promise<SessionRecord> {
  const db = await getDb();
  const now = Date.now();
  const s: SessionRecord = {
    id: uuid(),
    title: `${from.title} (cont.)`,
    modelId: from.modelId,
    systemPromptOverride: from.systemPromptOverride ?? null,
    paramsOverride: from.paramsOverride ?? null,
    personaId: from.personaId ?? null,
    continuedFromId: from.id,
    carryOver,
    createdAt: now,
    updatedAt: now,
  };
  if (db) {
    await db.runAsync(
      'INSERT INTO sessions (id, title, modelId, systemPromptOverride, paramsOverride, personaId, continuedFromId, carryOver, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [s.id, s.title, s.modelId, s.systemPromptOverride, s.paramsOverride, s.personaId, s.continuedFromId, s.carryOver, s.createdAt, s.updatedAt],
    );
  }
  return s;
}

async function insertGreeting(sessionId: string, persona: Persona): Promise<void> {
  if (!persona.greeting) return;
  await insertMessage({
    id: uuid(),
    sessionId,
    role: 'assistant',
    content: persona.greeting,
    modelName: persona.name,
    tokenCount: null,
    tokensPerSec: null,
    stopped: 0,
    createdAt: Date.now(),
    parentId: null,
    kind: 'greeting',
  });
}

export type PersonaChoice = { kind: 'none' } | { kind: 'persona'; id: string } | { kind: 'custom'; text: string };

/** The choice a session currently represents. */
export function personaChoiceOf(session: Pick<SessionRecord, 'systemPromptOverride' | 'personaId'> | null): PersonaChoice {
  if (session?.systemPromptOverride != null) return { kind: 'custom', text: session.systemPromptOverride };
  if (session?.personaId) return { kind: 'persona', id: session.personaId };
  return { kind: 'none' };
}

/**
 * Change what a chat's instructions come from. While the user hasn't sent
 * anything yet, the greeting follows the persona.
 */
export async function setSessionPersona(sessionId: string, choice: PersonaChoice): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const fields: Partial<SessionRecord> =
    choice.kind === 'persona' ? { personaId: choice.id, systemPromptOverride: null }
    : choice.kind === 'custom' ? { personaId: null, systemPromptOverride: choice.text }
    : { personaId: null, systemPromptOverride: null };
  await updateSession(sessionId, fields);
  if (!isChatEmpty(await getSessionMessages(sessionId))) return;
  await db.runAsync("DELETE FROM messages WHERE sessionId = ? AND kind = 'greeting'", [sessionId]);
  await db.runAsync('UPDATE sessions SET rootMessageId = NULL WHERE id = ?', [sessionId]);
  if (choice.kind === 'persona') {
    const persona = await getPersona(choice.id);
    if (persona) await insertGreeting(sessionId, persona);
  }
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

async function getAllSessionMessages(sessionId: string): Promise<MessageRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return (await db.getAllAsync('SELECT * FROM messages WHERE sessionId = ? ORDER BY createdAt ASC', [sessionId])) as MessageRecord[];
}

/**
 * The chat as shown: the selected version of every message. Messages with
 * other versions carry `versions`.
 */
export async function getSessionMessages(sessionId: string): Promise<MessageRecord[]> {
  const db = await getDb();
  if (!db) return [];
  const session = await getSession(sessionId);
  const all = await getAllSessionMessages(sessionId);
  const path = visiblePath(all, session?.rootMessageId);
  const versions = versionsOf(all, path);
  return path.map((m) => (versions.has(m.id) ? { ...m, versions: versions.get(m.id) } : m));
}

/** `messageId` and the messages before it on its branch. */
export async function getMessagePath(sessionId: string, messageId: string | null): Promise<MessageRecord[]> {
  if (!messageId) return [];
  return pathTo(await getAllSessionMessages(sessionId), messageId);
}

/** Show `messageId`'s version wherever it is chosen (its parent, or the session for a first message). */
export async function selectMessage(m: Pick<MessageRecord, 'id' | 'sessionId' | 'parentId'>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (m.parentId) await db.runAsync('UPDATE messages SET selectedChildId = ? WHERE id = ?', [m.id, m.parentId]);
  else await db.runAsync('UPDATE sessions SET rootMessageId = ? WHERE id = ?', [m.id, m.sessionId]);
}

/** Select `messageId` and every message above it, so its branch is the one shown (e.g. a search hit). */
export async function revealMessage(sessionId: string, messageId: string): Promise<void> {
  for (const m of await getMessagePath(sessionId, messageId)) await selectMessage(m);
}

/** Add a message under `m.parentId` and make it the version shown. */
export async function insertMessage(m: MessageRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    'INSERT INTO messages (id, sessionId, role, content, modelName, tokenCount, tokensPerSec, stopped, createdAt, reasoning, thinkingMs, parentId, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [m.id, m.sessionId, m.role, m.content, m.modelName, m.tokenCount, m.tokensPerSec, m.stopped, m.createdAt, m.reasoning ?? null, m.thinkingMs ?? null, m.parentId ?? null, m.kind ?? null]
  );
  await selectMessage(m);
}

export async function updateMessage(id: string, fields: Partial<MessageRecord>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // `versions` is computed, not stored.
  const keys = Object.keys(fields).filter((k) => k !== 'id' && k !== 'versions');
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

export async function countUserMessages(sessionId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const row = await db.getFirstAsync("SELECT COUNT(*) as cnt FROM messages WHERE sessionId = ? AND role = 'user'", [sessionId]);
  return (row as any)?.cnt ?? 0;
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
  const term = buildFtsQuery(query);
  if (!term) return [];
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

// ── Personas (stored in prompt_presets) ──

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function rowToPersona(r: any): Persona {
  const examples = parseJson<PersonaExample[]>(r.examples, []);
  return {
    id: r.id,
    name: r.name,
    content: r.content ?? '',
    greeting: r.greeting || null,
    examples: Array.isArray(examples) ? examples.filter((e) => e && typeof e.user === 'string' && typeof e.assistant === 'string') : [],
    params: completionParamsOnly(parseJson<ParamSet>(r.params, {})),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt,
  };
}

function personaColumns(p: Partial<Persona>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'id') continue;
    if (k === 'examples') out.examples = JSON.stringify(v ?? []);
    else if (k === 'params') out.params = serializeParamSet(completionParamsOnly((v ?? {}) as ParamSet));
    else out[k] = v ?? null;
  }
  return out;
}

export async function getAllPersonas(): Promise<Persona[]> {
  const db = await getDb();
  if (!db) return [];
  return ((await db.getAllAsync('SELECT * FROM prompt_presets ORDER BY createdAt DESC')) as any[]).map(rowToPersona);
}

export async function getPersona(id: string): Promise<Persona | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync('SELECT * FROM prompt_presets WHERE id = ?', [id]);
  return row ? rowToPersona(row) : null;
}

export async function insertPersona(p: Persona): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const cols = { id: p.id, ...personaColumns(p) };
  const keys = Object.keys(cols);
  await db.runAsync(`INSERT INTO prompt_presets (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(cols) as any[]);
}

export async function updatePersona(id: string, fields: Partial<Persona>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const cols = personaColumns({ ...fields, updatedAt: Date.now() });
  const keys = Object.keys(cols);
  await db.runAsync(`UPDATE prompt_presets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...(Object.values(cols) as any[]), id]);
}

export async function deletePersona(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync('UPDATE sessions SET personaId = NULL WHERE personaId = ?', [id]);
  await db.runAsync('DELETE FROM prompt_presets WHERE id = ?', [id]);
  if ((await getSetting('defaultPersonaId')) === id) await setSetting('defaultPersonaId', '');
}

export async function personaNameExists(name: string, excludeId?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row = excludeId
    ? await db.getFirstAsync('SELECT 1 FROM prompt_presets WHERE name = ? AND id != ?', [name, excludeId])
    : await db.getFirstAsync('SELECT 1 FROM prompt_presets WHERE name = ?', [name]);
  return !!row;
}

// ── Backup ──

/** Everything except model files, for a backup. */
export async function exportBackup(): Promise<Backup> {
  const db = await getDb();
  const all = async (sql: string) => (db ? ((await db.getAllAsync(sql)) as Record<string, unknown>[]) : []);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: await all('SELECT * FROM settings'),
    models: await all('SELECT * FROM models'),
    sessions: await all('SELECT * FROM sessions'),
    messages: await all('SELECT * FROM messages ORDER BY createdAt ASC'),
    presets: await all('SELECT * FROM prompt_presets'),
    summaries: await all('SELECT * FROM summaries'),
  };
}

/**
 * Replace chats, presets and settings with a backup's, in one transaction.
 * Models stay; settings for models also on this phone are restored onto them.
 */
export async function restoreBackup(b: Backup): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const match = matchModels(b.models, (await getAllModels()) as unknown as Record<string, unknown>[]);
  await db.withExclusiveTransactionAsync(async (tx: any) => {
    const columns = async (table: string) =>
      ((await tx.getAllAsync(`PRAGMA table_info(${table})`)) as { name: string }[]).map((c) => c.name);
    const insertAll = async (table: string, rows: Record<string, unknown>[]) => {
      const cols = await columns(table);
      for (const row of rows) {
        const q = buildInsert(table, row, cols);
        if (q) await tx.runAsync(q.sql, q.values);
      }
    };

    await tx.execAsync('DELETE FROM summaries; DELETE FROM messages; DELETE FROM sessions; DELETE FROM prompt_presets;');
    await tx.runAsync("DELETE FROM settings WHERE key != 'lastModelId'");
    await insertAll('settings', settingsToRestore(b.settings));
    await insertAll('sessions', b.sessions.map((s) => ({ ...s, modelId: s.modelId ? (match.get(String(s.modelId)) ?? null) : null })));
    await insertAll('messages', b.messages);
    await insertAll('prompt_presets', b.presets);
    await insertAll('summaries', b.summaries ?? []);
    for (const m of b.models) {
      const localId = match.get(String(m.id));
      if (!localId) continue;
      const fields = MODEL_SETTING_COLUMNS.filter((k) => k in m);
      if (fields.length === 0) continue;
      await tx.runAsync(
        `UPDATE models SET ${fields.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...fields.map((k) => (m[k] ?? null) as any), localId],
      );
    }
  });
}
