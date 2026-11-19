const mockGetDocument = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockGetDocument(...a) }));
const mockFiles: Record<string, string> = {};
jest.mock('expo-file-system/legacy', () => ({
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!(from in mockFiles)) throw new Error('no access');
    mockFiles[to] = mockFiles[from]!;
  }),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: '/cache' },
  File: jest.fn().mockImplementation((dir: string, name: string) => {
    const uri = `${dir}/${name}`;
    return {
      uri,
      get exists() { return uri in mockFiles; },
      delete: () => { delete mockFiles[uri]; },
      text: async () => mockFiles[uri],
    };
  }),
}));
jest.mock('../lib/db', () => ({
  generateId: jest.fn(() => 'p1'),
  getAllPersonas: jest.fn(async () => [{ name: 'Wren' }]),
  insertPersona: jest.fn(async () => {}),
}));

import * as db from '../lib/db';
import { importPersonaFromFile } from '../lib/personaImport';

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockFiles)) delete mockFiles[k];
});

it('cancelled picker: nothing happens', async () => {
  mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
  expect(await importPersonaFromFile()).toBeNull();
  expect(db.insertPersona).not.toHaveBeenCalled();
});

it('imports a Markdown file from Downloads as a new persona with a unique name', async () => {
  mockFiles['content://downloads/soul.md'] = '---\nname: Wren\n---\nBe warm.\n';
  mockGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'content://downloads/soul.md', name: 'soul.md' }] });
  const r = await importPersonaFromFile();
  expect(r).toEqual({ persona: expect.objectContaining({ id: 'p1', name: 'Wren (2)', content: 'Be warm.' }) });
  expect(db.insertPersona).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Wren (2)' }));
  expect(mockFiles['/cache/persona-import.md']).toBeUndefined();
});

it('a file with no instructions is refused', async () => {
  mockFiles['content://x/empty.md'] = '---\nname: X\n---\n<!-- nothing -->\n';
  mockGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'content://x/empty.md', name: 'empty.md' }] });
  expect(await importPersonaFromFile()).toEqual({ error: 'That file has no instructions in it.' });
  expect(db.insertPersona).not.toHaveBeenCalled();
});

it('an unreadable file reports why', async () => {
  mockGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'content://gone', name: 'gone.md' }] });
  expect(await importPersonaFromFile()).toEqual({ error: "Couldn't read that file: no access" });
});
