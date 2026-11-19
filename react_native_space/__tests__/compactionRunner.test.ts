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
  getLoadedModelId: jest.fn(() => 'm'),
}));
jest.mock('../lib/modelMeta', () => ({
  prepareModel: jest.fn((model: any) => Promise.resolve({ model, load: {}, completion: { temperature: 0.8, n_predict: 1024 } })),
}));

import * as db from '../lib/db';
import * as llama from '../lib/llama';
import { compactIfNeeded, prepareContinuation } from '../lib/compactionRunner';
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
  expect(opts).toEqual(expect.objectContaining({ label: 'compaction' }));
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

describe('prepareContinuation', () => {
  it('carries the summary and every message after it', async () => {
    (llama.countTokens as jest.Mock).mockResolvedValue(5); // short chat: no compaction
    (db.getSummaries as jest.Mock).mockResolvedValue([
      { id: 'x', sessionId: 's', throughMessageId: 'm3', content: 'Earlier we planned a trip.', tokenCount: 9, modelName: null, createdAt: 1 },
    ]);
    const text = await prepareContinuation('s', model);
    expect(llama.generate).not.toHaveBeenCalled();
    // Everything after the summary (m4–m11), not just the last 4: nothing between them is lost.
    expect(text).toBe('Earlier we planned a trip.\n\n' + [4, 5, 6, 7, 8, 9, 10, 11].map((i) => `${i % 2 === 0 ? 'User' : 'Assistant'}: message ${i}`).join('\n'));
  });

  it('condenses everything but the last exchange when the chat is over 20%', async () => {
    // 12 × 48 + 40 = 616: under the 70% trigger, over 20%.
    (llama.countTokens as jest.Mock).mockResolvedValue(40);
    (llama.generate as jest.Mock).mockResolvedValue(result({ content: 'Fresh summary.' }));
    const text = await prepareContinuation('s', model);
    expect(llama.generate).toHaveBeenCalledTimes(1);
    expect((db.insertSummary as jest.Mock).mock.calls[0][0].throughMessageId).toBe('m9');
    expect(text).toBe('Fresh summary.\n\nUser: message 10\nAssistant: message 11');
  });

  it('carries at most 20% of the space', async () => {
    // No model: the default 8192 context, budget 7152 → 1430 tokens. Each message ≈ 500.
    (db.getSessionMessages as jest.Mock).mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ ...msg(i), content: 'x'.repeat(2000) })));
    const text = await prepareContinuation('s', null);
    expect(text.split('\n').filter((l) => /^(User|Assistant): /.test(l))).toHaveLength(2);
  });

  it('works without a loaded model (no compaction)', async () => {
    const text = await prepareContinuation('s', null);
    expect(llama.generate).not.toHaveBeenCalled();
    expect(text).toContain('User: message 10');
  });
});

describe('compaction that must save nothing', () => {
  beforeEach(() => (llama.countTokens as jest.Mock).mockResolvedValue(60));

  it('cancelled before the summary request starts: no request, nothing saved', async () => {
    const cancel = { stop: false };
    (llama.countTokens as jest.Mock).mockImplementation(async () => { cancel.stop = true; return 60; });
    expect(await compactIfNeeded('s', model, { cancel })).toBeNull();
    expect(llama.generate).not.toHaveBeenCalled();
    expect(db.insertSummary).not.toHaveBeenCalled();
  });

  it('passes its cancel token to generate as the stop flag', async () => {
    const cancel = { stop: false };
    (llama.generate as jest.Mock).mockImplementation(async () => { cancel.stop = true; return result(); });
    expect(await compactIfNeeded('s', model, { cancel })).toBeNull();
    expect((llama.generate as jest.Mock).mock.calls[0][5]).toEqual({ label: 'compaction', stopRef: cancel });
    expect(db.insertSummary).not.toHaveBeenCalled();
  });

  it('cut off by the length limit', async () => {
    (llama.generate as jest.Mock).mockResolvedValue(result({ cutOff: true }));
    expect(await compactIfNeeded('s', model)).toBeNull();
    expect(db.insertSummary).not.toHaveBeenCalled();
  });

  it('the model was swapped while it ran', async () => {
    (llama.generate as jest.Mock).mockImplementation(async () => {
      (llama.getLoadedModelId as jest.Mock).mockReturnValue('other');
      return result();
    });
    expect(await compactIfNeeded('s', model)).toBeNull();
    expect(db.insertSummary).not.toHaveBeenCalled();
    (llama.getLoadedModelId as jest.Mock).mockReturnValue('m');
  });

  it('messages being condensed did not fit, so the request was cut short', async () => {
    (llama.generate as jest.Mock).mockResolvedValue(result({ droppedMessages: 1 }));
    expect(await compactIfNeeded('s', model)).toBeNull();
    expect(db.insertSummary).not.toHaveBeenCalled();
  });
});

it('turns thinking off in chat_template_kwargs too', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(60);
  (llama.generate as jest.Mock).mockResolvedValue(result());
  const modelMeta = require('../lib/modelMeta');
  (modelMeta.prepareModel as jest.Mock).mockResolvedValueOnce({ model, load: {}, completion: { temperature: 0.3, chat_template_kwargs: { enable_thinking: true, x: 1 } } });
  await compactIfNeeded('s', model);
  expect((llama.generate as jest.Mock).mock.calls[0][2].chat_template_kwargs).toEqual({ enable_thinking: false, x: 1 });
});

it('a leading greeting is not condensed as a turn; the summary still ends on the right message', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(60);
  (llama.generate as jest.Mock).mockResolvedValue(result());
  const greeting = { ...msg(99), id: 'g', role: 'assistant', content: 'Hello!', kind: 'greeting' };
  (db.getSessionMessages as jest.Mock).mockResolvedValue([greeting, ...Array.from({ length: 12 }, (_, i) => msg(i))]);
  const s = await compactIfNeeded('s', model);
  const messages = (llama.generate as jest.Mock).mock.calls[0][1];
  expect(messages[1]).toEqual({ role: 'user', content: 'message 0' });
  const condensed = messages.slice(1, -1);
  expect(condensed[condensed.length - 1].content).toBe(`message ${Number(s!.throughMessageId.slice(1))}`);
});

it('turns off penalties that would punish a summary for repeating the conversation', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(60);
  (llama.generate as jest.Mock).mockResolvedValue(result());
  const modelMeta = require('../lib/modelMeta');
  (modelMeta.prepareModel as jest.Mock).mockResolvedValueOnce({ model, load: {}, completion: { temperature: 0.7, dry_multiplier: 0.8, penalty_present: 1.5, penalty_freq: 0.5 } });
  await compactIfNeeded('s', model);
  expect((llama.generate as jest.Mock).mock.calls[0][2]).toMatchObject({ dry_multiplier: 0, penalty_present: 0, penalty_freq: 0 });
});

it('logs why a summary was not saved', async () => {
  (llama.countTokens as jest.Mock).mockResolvedValue(60);
  (llama.generate as jest.Mock).mockResolvedValue(result({ cutOff: true }));
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  await compactIfNeeded('s', model);
  expect(spy).toHaveBeenCalledWith(expect.stringContaining('[gen] compaction: not saved (hit the length limit)'));
  spy.mockRestore();
});
