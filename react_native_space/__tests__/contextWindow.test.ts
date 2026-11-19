import { fitToContext, PER_MESSAGE_OVERHEAD } from '@/lib/contextWindow';
import type { ChatMessage } from '@/types';

// 1 token per character keeps the arithmetic obvious.
const count = async (t: string) => t.length;
const msg = (role: ChatMessage['role'], n: number): ChatMessage => ({ role, content: 'x'.repeat(n) });

describe('fitToContext', () => {
  it('keeps everything when it fits', async () => {
    const m = [msg('system', 10), msg('user', 10), msg('assistant', 10), msg('user', 10)];
    const r = await fitToContext(m, 4096, 1024, count);
    expect(r.dropped).toBe(0);
    expect(r.messages).toEqual(m);
  });

  it('drops oldest turns, keeps system prompt and latest message', async () => {
    const sys = msg('system', 50);
    const m = [sys, msg('user', 400), msg('assistant', 400), msg('user', 100), msg('assistant', 100), msg('user', 50)];
    // budget = 1000 - 300 - 16 = 684
    const r = await fitToContext(m, 1000, 300, count);
    expect(r.messages[0]).toBe(sys);
    expect(r.messages[r.messages.length - 1]).toBe(m[5]);
    expect(r.dropped).toBe(2);
    const total = r.messages.reduce((a, x) => a + x.content.length + PER_MESSAGE_OVERHEAD, 0);
    expect(total).toBeLessThanOrEqual(684);
  });

  it('never starts the kept history on an assistant turn', async () => {
    const m = [msg('user', 500), msg('assistant', 10), msg('user', 10)];
    const r = await fitToContext(m, 600, 200, count);
    expect(r.messages[0]!.role).toBe('user');
    expect(r.dropped).toBe(2);
  });

  it('always keeps the latest message even if it alone is too big', async () => {
    const m = [msg('system', 10), msg('user', 5000)];
    const r = await fitToContext(m, 1000, 200, count);
    expect(r.messages).toHaveLength(2);
    expect(r.dropped).toBe(0);
  });

  it('works without a system prompt', async () => {
    const m = [msg('user', 600), msg('assistant', 600), msg('user', 10)];
    const r = await fitToContext(m, 1000, 200, count);
    expect(r.messages).toEqual([m[2]]);
  });
  it('reports the estimated size of the kept prompt', async () => {
    const m = [msg('system', 50), msg('user', 400), msg('assistant', 400), msg('user', 50)];
    const r = await fitToContext(m, 1000, 300, count);
    // keeps system + last user: (50 + 8) + (50 + 8)
    expect(r.tokens).toBe(116);
  });
});
