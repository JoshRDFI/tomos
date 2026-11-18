import { parsePersonaMarkdown, serializePersonaMarkdown } from '@/lib/personaMarkdown';

describe('parsePersonaMarkdown', () => {
  it('parses a plain soul.md as instructions only', () => {
    expect(parsePersonaMarkdown('\nYou are warm and curious.\nAsk follow-up questions.\n', 'soul.md')).toEqual({
      name: 'Soul', content: 'You are warm and curious.\nAsk follow-up questions.', greeting: null, examples: [], params: {},
    });
  });

  it('reads front matter name and completion params, drops n_ctx and unknown keys', () => {
    const r = parsePersonaMarkdown('---\nname: Friendly\ntemperature: 0.8\nn_ctx: 8192\nmood: happy\n---\nBe nice.', 'x.md');
    expect(r.name).toBe('Friendly');
    expect(r.params).toEqual({ temperature: 0.8 });
    expect(r.content).toBe('Be nice.');
  });

  it('reads Greeting and Examples sections', () => {
    const text = [
      'Be nice.', '', '## Greeting', 'Hello there!', '', '## Examples',
      'User: hi', 'Assistant: hey', '', 'User: what is 2+2?', 'Assistant: Four.', 'Easy one.',
    ].join('\n');
    const r = parsePersonaMarkdown(text, 'x.md');
    expect(r.content).toBe('Be nice.');
    expect(r.greeting).toBe('Hello there!');
    expect(r.examples).toEqual([
      { user: 'hi', assistant: 'hey' },
      { user: 'what is 2+2?', assistant: 'Four.\nEasy one.' },
    ]);
  });

  it('drops an incomplete example pair', () => {
    const r = parsePersonaMarkdown('Be nice.\n\n## Examples\nUser: a\n\nUser: b\nAssistant: c', 'x.md');
    expect(r.examples).toEqual([{ user: 'b', assistant: 'c' }]);
  });

  it('handles CRLF and a BOM', () => {
    const lf = '---\nname: N\n---\nBe nice.\n\n## Greeting\nHi';
    expect(parsePersonaMarkdown('﻿' + lf.replace(/\n/g, '\r\n'), 'x.md')).toEqual(parsePersonaMarkdown(lf, 'x.md'));
  });

  it('round-trips', () => {
    const x = {
      name: 'Friendly explainer', content: 'Explain simply.\nUse analogies.', greeting: 'Hi! What shall we explore?',
      examples: [{ user: 'What is DNS?', assistant: 'A phone book for the internet.' }, { user: 'Why?', assistant: 'Names are\neasier.' }],
      params: { temperature: 0.7, enable_thinking: false },
    };
    expect(parsePersonaMarkdown(serializePersonaMarkdown(x), 'x.md')).toEqual(x);
  });
});
