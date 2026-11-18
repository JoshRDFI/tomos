import { composeSystemMessage, formatExamples, toChatMessages } from '@/lib/prompt';
import { withDate } from '@/lib/dateContext';
import type { MessageRecord } from '@/types';

const d = new Date(2026, 10, 18);

it('formatExamples', () => {
  expect(formatExamples([])).toBe('');
  expect(formatExamples([{ user: 'hi', assistant: 'yo' }, { user: 'a', assistant: 'b' }]))
    .toBe('Examples of how you reply:\nUser: hi\nAssistant: yo\n\nUser: a\nAssistant: b');
});

describe('composeSystemMessage', () => {
  const base = { instructions: 'Be kind.', date: null, examples: [], summary: null, carryOver: null };
  it('instructions only', () => expect(composeSystemMessage(base)).toBe('Be kind.'));
  it('date via withDate', () => expect(composeSystemMessage({ ...base, date: d })).toBe(withDate('Be kind.', d)));
  it('summary replaces carry-over', () => {
    const s = composeSystemMessage({ ...base, summary: 'S', carryOver: 'CARRY' });
    expect(s).toContain('Summary of the earlier part of this conversation:\nS');
    expect(s).not.toContain('CARRY');
  });
  it('carry-over when no summary, after examples', () => {
    const s = composeSystemMessage({ ...base, examples: [{ user: 'u', assistant: 'a' }], carryOver: 'C' });
    expect(s.indexOf('Examples of how you reply:')).toBeGreaterThan(-1);
    expect(s.indexOf('Examples of how you reply:')).toBeLessThan(s.indexOf('Earlier conversation (continued from another chat):\nC'));
  });
});

it('toChatMessages strips thinking from old replies', () => {
  const m = (role: 'user' | 'assistant', content: string, reasoning: string | null = null): MessageRecord => ({
    id: content, sessionId: 's', role, content, reasoning, modelName: null, tokenCount: null, tokensPerSec: null, stopped: 0, createdAt: 0,
  });
  expect(toChatMessages([m('user', 'q'), m('assistant', '<think>t</think>a'), m('assistant', 'b', 'r')]))
    .toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b' }]);
});
