import {
  completionParamsOnly, isChatEmpty, linkExactCopies, pickDefaultPersona, resolveInstructions, uniqueName,
} from '@/lib/personas';
import type { Persona } from '@/types';

const p = (id: string, content = 'x', createdAt = 1): Persona => ({
  id, name: id, content, greeting: null, examples: [], params: {}, createdAt, updatedAt: createdAt,
});

describe('resolveInstructions', () => {
  it('custom text wins', () => {
    expect(resolveInstructions({ systemPromptOverride: 'c', personaId: 'a' }, [p('a')], 'd')).toEqual({ kind: 'custom', text: 'c' });
  });
  it('then the persona', () => {
    expect(resolveInstructions({ systemPromptOverride: null, personaId: 'a' }, [p('a')], 'd').kind).toBe('persona');
  });
  it('a deleted persona falls back to the default prompt', () => {
    expect(resolveInstructions({ systemPromptOverride: null, personaId: 'gone' }, [p('a')], 'd')).toEqual({ kind: 'default', text: 'd' });
  });
  it('no session → default', () => {
    expect(resolveInstructions(null, [], 'd')).toEqual({ kind: 'default', text: 'd' });
  });
});

it('pickDefaultPersona ignores a deleted id', () => {
  expect(pickDefaultPersona('gone', [p('a')])).toBeNull();
  expect(pickDefaultPersona(null, [p('a')])).toBeNull();
  expect(pickDefaultPersona('a', [p('a')])?.id).toBe('a');
});

it('completionParamsOnly drops load-time keys', () => {
  expect(completionParamsOnly({ temperature: 0.7, n_ctx: 8192, n_gpu_layers: 99 })).toEqual({ temperature: 0.7 });
});

it('isChatEmpty counts only user messages', () => {
  expect(isChatEmpty([])).toBe(true);
  expect(isChatEmpty([{ role: 'assistant' }])).toBe(true);
  expect(isChatEmpty([{ role: 'assistant' }, { role: 'user' }])).toBe(false);
});

it('uniqueName', () => {
  expect(uniqueName('Soul', [])).toBe('Soul');
  expect(uniqueName('Soul', ['Soul'])).toBe('Soul (2)');
  expect(uniqueName('Soul', ['Soul', 'Soul (2)'])).toBe('Soul (3)');
});

describe('linkExactCopies', () => {
  it('links exact copies, oldest persona first, leaves others', () => {
    const r = linkExactCopies(
      [p('new', 'T', 5), p('old', 'T', 1)],
      [{ id: 's1', systemPromptOverride: 'T' }, { id: 's2', systemPromptOverride: 'T ' }, { id: 's3', systemPromptOverride: null }],
      'T',
    );
    expect(r.sessionLinks).toEqual([{ sessionId: 's1', personaId: 'old' }]);
    expect(r.defaultPersonaId).toBe('old');
  });
  it('no match → nothing', () => {
    expect(linkExactCopies([p('a', 'A')], [], 'B')).toEqual({ sessionLinks: [], defaultPersonaId: null });
  });
});
