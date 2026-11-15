import { splitThinking, formatThinkingTime, resolveStreamView } from '../lib/thinking';

describe('splitThinking', () => {
  it('passes plain answers through', () => {
    expect(splitThinking('Hello there')).toEqual({ thinking: '', answer: 'Hello there', open: false });
  });

  it('splits a closed think block', () => {
    expect(splitThinking('<think>\nLet me see.\n</think>\n\nThe answer is 4.')).toEqual({
      thinking: 'Let me see.', answer: 'The answer is 4.', open: false,
    });
  });

  it('reports an unclosed block while streaming', () => {
    expect(splitThinking('<think>Working on it')).toEqual({ thinking: 'Working on it', answer: '', open: true });
  });

  it('hides a partially arrived opening tag', () => {
    expect(splitThinking('<thi')).toEqual({ thinking: '', answer: '', open: true });
    expect(splitThinking('[THI')).toEqual({ thinking: '', answer: '', open: true });
  });

  it('handles templates that open the block in the prompt', () => {
    expect(splitThinking('reasoning here</think>\nAnswer.')).toEqual({
      thinking: 'reasoning here', answer: 'Answer.', open: false,
    });
  });

  it('supports other tag styles', () => {
    expect(splitThinking('<thinking>a</thinking>b')).toEqual({ thinking: 'a', answer: 'b', open: false });
    expect(splitThinking('[THINK]a[/THINK]b')).toEqual({ thinking: 'a', answer: 'b', open: false });
  });

  it('leaves tags later in an answer alone', () => {
    const raw = 'Use <think> tags like <think>this</think> in prompts.';
    expect(splitThinking(raw)).toEqual({ thinking: '', answer: raw, open: false });
  });

  it('treats an empty think block as no thinking', () => {
    expect(splitThinking('<think>\n\n</think>\n\nHi')).toEqual({ thinking: '', answer: 'Hi', open: false });
  });
});

describe('formatThinkingTime', () => {
  it('formats seconds and minutes', () => {
    expect(formatThinkingTime(200)).toBe('1 s');
    expect(formatThinkingTime(12_400)).toBe('12 s');
    expect(formatThinkingTime(60_000)).toBe('1 min');
    expect(formatThinkingTime(65_000)).toBe('1 min 5 s');
  });
});

describe('resolveStreamView', () => {
  const st = (raw: string, nativeThinking: string | null = null, nativeContent: string | null = null) =>
    ({ raw, nativeThinking, nativeContent });

  it("uses llama.rn's parse while thinking", () => {
    expect(resolveStreamView(st('<think>Hmm', 'Hmm'), true)).toEqual({ thinking: 'Hmm', answer: '', thinkingOpen: true });
  });

  it("uses llama.rn's parse once the answer starts", () => {
    expect(resolveStreamView(st('<think>Hmm</think>\n\nYes', 'Hmm', '\n\nYes'), true))
      .toEqual({ thinking: 'Hmm', answer: 'Yes', thinkingOpen: false });
  });

  it('splits tags itself when llama.rn reports no thinking', () => {
    // e.g. a format llama.cpp doesn't recognise: content still has the tags
    expect(resolveStreamView(st('x', null, '<think>a</think>b'), true)).toEqual({ thinking: 'a', answer: 'b', thinkingOpen: false });
    // manual template: only raw tokens
    expect(resolveStreamView(st('<think>a'), true)).toEqual({ thinking: 'a', answer: '', thinkingOpen: true });
  });

  it('shows raw output when splitting is off', () => {
    expect(resolveStreamView(st('<think>a</think>b'), false)).toEqual({ thinking: '', answer: '<think>a</think>b', thinkingOpen: false });
  });

  it('passes plain answers through', () => {
    expect(resolveStreamView(st('', null, 'Hello'), true)).toEqual({ thinking: '', answer: 'Hello', thinkingOpen: false });
  });
});
