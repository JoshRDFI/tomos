import {
  activeSummary, buildCarryOver, messagesAfter, planCompaction, summariesOnPath, summaryRequest, SUMMARY_INSTRUCTION,
} from '@/lib/compaction';
import { PER_MESSAGE_OVERHEAD } from '@/lib/contextWindow';
import type { Summary } from '@/types';

const sum = (id: string, through: string, createdAt: number): Summary => ({
  id, sessionId: 's', throughMessageId: through, content: id, tokenCount: 10, modelName: null, createdAt,
});
const path = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

describe('activeSummary', () => {
  it('picks the newest on-path summary and ignores off-branch ones', () => {
    const list = [sum('s1', 'b', 1), sum('s2', 'd', 2), sum('off', 'x', 3)];
    expect(activeSummary(list, path)?.id).toBe('s2');
    expect(summariesOnPath(list, path).map((s) => s.id)).toEqual(['s1', 's2']);
  });
  it('returns null when an edit moved the path before every summary', () => {
    expect(activeSummary([sum('s1', 'c', 1)], [{ id: 'a' }, { id: 'b2' }])).toBeNull();
  });
  it('messagesAfter', () => {
    expect(messagesAfter(path, sum('s', 'b', 1)).map((m) => m.id)).toEqual(['c', 'd', 'e']);
    expect(messagesAfter(path, null)).toHaveLength(5);
  });
});

const alt = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant');
const cost = (counts: number[], from: number) => counts.slice(from).reduce((a, n) => a + n + PER_MESSAGE_OVERHEAD, 0);

describe('planCompaction', () => {
  it('returns null under 70%', () => {
    expect(planCompaction({ fixedTokens: 100, counts: Array(8).fill(50), roles: alt(8), budget: 1000 })).toBeNull();
  });
  it('condenses down to 40% and keeps at least 4', () => {
    const counts = Array(12).fill(60);
    const r = planCompaction({ fixedTokens: 100, counts, roles: alt(12), budget: 1000 })!;
    expect(r).not.toBeNull();
    const kept = 12 - (r.throughIndex + 1);
    expect(kept).toBeGreaterThanOrEqual(4);
    expect(100 + cost(counts, r.throughIndex + 1)).toBeLessThanOrEqual(400);
  });
  it('kept part starts with a user message', () => {
    const roles = alt(12);
    const r = planCompaction({ fixedTokens: 100, counts: Array(12).fill(80), roles, budget: 1000 })!;
    expect(roles[r.throughIndex + 1]).toBe('user');
  });
  it('a huge last message keeps the last 4 anyway', () => {
    const r = planCompaction({ fixedTokens: 0, counts: [50, 50, 50, 50, 50, 3000], roles: alt(6), budget: 1000 });
    expect(r).toEqual({ throughIndex: 1 });
  });
  it('never plans an empty condense', () => {
    expect(planCompaction({ fixedTokens: 0, counts: [50, 50, 50, 3000], roles: alt(4), budget: 1000 })).toBeNull();
  });
  it('counts the summary/carry-over in fixedTokens', () => {
    const base = { counts: Array(8).fill(60), roles: alt(8), budget: 1000 };
    expect(planCompaction({ ...base, fixedTokens: 0 })).toBeNull();
    expect(planCompaction({ ...base, fixedTokens: 500 })).not.toBeNull();
  });
  it('trigger override', () => {
    const base = { fixedTokens: 100, counts: Array(8).fill(50), roles: alt(8), budget: 1000 };
    expect(planCompaction(base)).toBeNull();
    expect(planCompaction({ ...base, trigger: 0.4 })).not.toBeNull();
  });
});

it('summaryRequest ends with the instruction', () => {
  const r = summaryRequest('SYS', [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
  expect(r[0]).toEqual({ role: 'system', content: 'SYS' });
  expect(r[r.length - 1]).toEqual({ role: 'user', content: SUMMARY_INSTRUCTION });
  expect(r).toHaveLength(4);
});

describe('buildCarryOver', () => {
  const recent = [
    { role: 'user' as const, content: 'one' }, { role: 'assistant' as const, content: 'two' },
    { role: 'user' as const, content: 'three' }, { role: 'assistant' as const, content: 'four' },
  ];
  const chars = (s: string) => s.length;
  it('labels turns after the summary', () => {
    expect(buildCarryOver('SUM', recent, 1000, chars)).toBe('SUM\n\nUser: one\nAssistant: two\nUser: three\nAssistant: four');
  });
  it('drops the oldest turns first and keeps the summary', () => {
    const r = buildCarryOver('SUM', recent, 40, chars);
    expect(r.startsWith('SUM')).toBe(true);
    expect(r).not.toContain('one');
    expect(r).toContain('Assistant: four');
    expect(r.length).toBeLessThanOrEqual(40);
  });
  it('works without a summary', () => {
    expect(buildCarryOver(null, recent.slice(2), 1000, chars)).toBe('User: three\nAssistant: four');
  });
});
