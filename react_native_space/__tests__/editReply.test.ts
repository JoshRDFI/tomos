import { editedReply } from '../lib/editReply';
import type { MessageRecord } from '../types';

const original: MessageRecord = {
  id: 'a1', sessionId: 's1', role: 'assistant', content: '<think>plan</think>She runs. See you soon! :)',
  modelName: 'Qwen3', tokenCount: 120, tokensPerSec: 9.5, stopped: 1, createdAt: 1000,
  reasoning: 'plan', thinkingMs: 800, parentId: 'u1', kind: null,
  versions: { ids: ['a1', 'a0'], index: 0 },
};

describe('editedReply', () => {
  const v = editedReply(original, '  She runs.  ', 'a2', 5000);

  it('is a new version beside the original: same parent, chat and role', () => {
    expect(v).toMatchObject({ id: 'a2', parentId: 'u1', sessionId: 's1', role: 'assistant', modelName: 'Qwen3', createdAt: 5000 });
  });
  it('holds only the edited text, trimmed', () => expect(v.content).toBe('She runs.'));
  it('drops thinking, stats and the stopped flag, which described the old text', () => {
    expect(v).toMatchObject({ reasoning: null, thinkingMs: null, tokenCount: null, tokensPerSec: null, stopped: 0 });
  });
  it('keeps a greeting a greeting', () => expect(editedReply({ ...original, kind: 'greeting' }, 'Hi', 'g2', 1).kind).toBe('greeting'));
  it('carries no computed versions', () => expect(v.versions).toBeUndefined());
});
