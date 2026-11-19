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

describe('comments', () => {
  it('drops HTML comments anywhere in the body, including multi-line ones', () => {
    const md = '---\nname: X\n# a front-matter note\ntemperature: 0.5\n---\n<!-- what goes here -->\nBe brief.\n<!--\nlonger\nnote\n-->\n\n## Greeting\n<!-- optional -->\nHi.\n';
    expect(parsePersonaMarkdown(md, 'x.md')).toEqual({ name: 'X', content: 'Be brief.', greeting: 'Hi.', examples: [], params: { temperature: 0.5 } });
  });
});

describe('the repo template (personas/soul.md)', () => {
  const fs = require('fs');
  const path = require('path');
  const text: string = fs.readFileSync(path.join(__dirname, '../../personas/soul.md'), 'utf8');
  const p = parsePersonaMarkdown(text, 'soul.md');

  it('imports with every field filled', () => {
    expect(p.name).toBe('Wren');
    expect(p.content.length).toBeGreaterThan(100);
    expect(p.greeting).toBeTruthy();
    expect(p.examples).toHaveLength(2);
    expect(p.params).toEqual({ temperature: 0.7, top_p: 0.9 });
  });

  it('leaves none of the guidance in the persona', () => {
    const all = [p.content, p.greeting, ...p.examples.flatMap((e) => [e.user, e.assistant])].join('\n');
    expect(all).not.toMatch(/<!--|-->|TEMPLATE/);
  });
});
