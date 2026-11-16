import { BACKUP_FORMAT, BackupError, backupFileName, buildInsert, matchModels, parseBackup, settingsToRestore } from '../lib/backup';
import { dateSentence, formatDateLong, withDate } from '../lib/dateContext';

describe('dateContext', () => {
  const d = new Date(2026, 10, 15, 9, 30); // local time
  it('formats the date', () => {
    expect(formatDateLong(d)).toBe('Sunday, November 15, 2026');
    expect(dateSentence(d)).toBe('Today is Sunday, November 15, 2026.');
  });
  it('appends to the system prompt', () => {
    expect(withDate('Be brief.', d)).toBe('Be brief.\n\nToday is Sunday, November 15, 2026.');
    expect(withDate('  ', d)).toBe('Today is Sunday, November 15, 2026.');
  });
});

const valid = () => ({
  format: BACKUP_FORMAT,
  version: 1,
  exportedAt: 1_700_000_000_000,
  settings: [{ key: 'themeMode', value: 'dark' }, { key: 'lastModelId', value: 'm1' }],
  models: [{ id: 'm1', fileName: 'a.gguf', fileSizeBytes: 10 }],
  sessions: [{ id: 's1', title: 'Chat', modelId: 'm1' }],
  messages: [{ id: 'x', sessionId: 's1', role: 'user', content: 'hi' }],
  presets: [],
});

describe('parseBackup', () => {
  it('accepts a valid backup', () => {
    expect(parseBackup(JSON.stringify(valid())).sessions).toHaveLength(1);
  });

  it.each([
    ['not json', '{', 'not valid JSON'],
    ['another file', JSON.stringify({ hello: 1 }), "isn't an LLM Chat backup"],
    ['newer version', JSON.stringify({ ...valid(), version: 99 }), 'newer version'],
    ['missing table', JSON.stringify({ ...valid(), messages: undefined }), 'damaged (messages)'],
    ['orphan message', JSON.stringify({ ...valid(), messages: [{ id: 'y', sessionId: 'nope' }] }), 'without a chat'],
  ])('rejects %s', (_label, text, msg) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(msg);
  });
});

describe('restore helpers', () => {
  it('keeps install-specific settings out', () => {
    expect(settingsToRestore(valid().settings)).toEqual([{ key: 'themeMode', value: 'dark' }]);
  });

  it('matches models by file name and size', () => {
    const backup = [
      { id: 'b1', fileName: 'a.gguf', fileSizeBytes: 10 },
      { id: 'b2', fileName: 'a.gguf', fileSizeBytes: 11 },
      { id: 'b3', fileName: 'c.gguf', fileSizeBytes: 5 },
    ];
    const local = [{ id: 'L1', fileName: 'a.gguf', fileSizeBytes: 10 }, { id: 'L3', fileName: 'c.gguf', fileSizeBytes: 5 }];
    expect([...matchModels(backup, local).entries()]).toEqual([['b1', 'L1'], ['b3', 'L3']]);
  });

  it('builds inserts with only known columns', () => {
    expect(buildInsert('sessions', { id: 's', title: 'T', future: 1, rootMessageId: undefined }, ['id', 'title', 'rootMessageId'])).toEqual({
      sql: 'INSERT OR REPLACE INTO sessions (id, title, rootMessageId) VALUES (?, ?, ?)',
      values: ['s', 'T', null],
    });
    expect(buildInsert('x', { a: 1 }, ['b'])).toBeNull();
  });

  it('names the file by date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('llmchat-backup-2026-01-05.json');
  });
});
