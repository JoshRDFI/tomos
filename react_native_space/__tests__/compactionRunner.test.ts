jest.mock('../lib/db', () => ({
  generateId: jest.fn(() => 'sum1'),
  getSession: jest.fn(),
  getSessionMessages: jest.fn(),
  getSummaries: jest.fn(),
  buildSystemMessage: jest.fn(() => Promise.resolve('SYS')),
  insertSummary: jest.fn(() => Promise.resolve()),
}));
jest.mock('../lib/llama', () => ({
  countTokens: jest.fn(),
  promptBudget: jest.fn(() => 1000),
  generate: jest.fn(),
}));
jest.mock('../lib/modelMeta', () => ({
  prepareModel: jest.fn((model: any) => Promise.resolve({ model, load: {}, completion: { temperature: 0.8, n_predict: 1024 } })),
}));

import * as db from '../lib/db';
import * as llama from '../lib/llama';
import { compactIfNeeded } from '../lib/compactionRunner';
import { SUMMARY_INSTRUCTION } from '../lib/compaction';
import type { MessageRecord, ModelRecord } from '../types';

const model = { id: 'm', displayName: 'Qwen' } as ModelRecord;
const msg = (i: number): MessageRecord => ({
  id: `m${i}`, sessionId: 's', role: i % 2 === 0 ? 'user' : 'assistant', content: `message ${i}`,
  modelName: null, tokenCount: null, tokensPerSec: null, stopped: 0, createdAt: i,
});
const result = (over: Partial<Record<string, unknown>> = {}) => ({
  content: 'A short summary.', reasoning: '', tokenCount: 50, tokensPerSec: 3, thinkingMs: null, stopped: false, cutOff: false, droppedMessages: 0, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (db.getSession as jest.Mock).mockResolvedValue({ id: 's', carryOver: null });
  (db.getSessionMessages as jest.Mock).mockResolvedValue(Array.from({ length: 12 }, (_, i) => msg(i)));
  (db.getSummaries as jest.Mock).mockResolvedValue([]);
});

it('does nothing under the trigger', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(10);
  expect(await compactIfNeeded('s', model)).toBeNull();
  expect(llama.generate).not.toHaveBeenCalled();
});

it('writes a summary through the last condensed message', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(60); // 12 × 68 + 60 > 700
  (llama.generate as jest.Mock).mockResolvedValue(result());
  const onStart = jest.fn();
  const s = await compactIfNeeded('s', model, { onStart });
  expect(onStart).toHaveBeenCalled();
  const [, messages, params, , prefill, opts] = (llama.generate as jest.Mock).mock.calls[0];
  expect(messages[0]).toEqual({ role: 'system', content: 'SYS' });
  expect(messages[messages.length - 1]).toEqual({ role: 'user', content: SUMMARY_INSTRUCTION });
  expect(params).toMatchObject({ enable_thinking: false, n_predict: 400, temperature: 0.5 });
  expect(prefill).toBeUndefined();
  expect(opts).toEqual({ label: 'compaction' });
  expect(db.insertSummary).toHaveBeenCalledWith(expect.objectContaining({
    sessionId: 's', content: 'A short summary.', modelName: 'Qwen', throughMessageId: s!.throughMessageId,
  }));
  // Condensed messages are the ones before the kept part, which starts with a user message.
  const condensed = messages.slice(1, -1);
  expect(condensed[condensed.length - 1].content).toBe(`message ${Number(s!.throughMessageId.slice(1))}`);
  expect(Number(s!.throughMessageId.slice(1)) % 2).toBe(1);
});

it('saves nothing when stopped', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(60);
  (llama.generate as jest.Mock).mockResolvedValue(result({ stopped: true }));
  expect(await compactIfNeeded('s', model)).toBeNull();
  expect(db.insertSummary).not.toHaveBeenCalled();
});

it('strips thinking; empty after stripping saves nothing', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(60);
  (llama.generate as jest.Mock).mockResolvedValue(result({ content: '<think>x</think>' }));
  expect(await compactIfNeeded('s', model)).toBeNull();
  expect(db.insertSummary).not.toHaveBeenCalled();

  (llama.generate as jest.Mock).mockResolvedValue(result({ content: '<think>x</think>The summary.' }));
  expect((await compactIfNeeded('s', model))?.content).toBe('The summary.');
});
