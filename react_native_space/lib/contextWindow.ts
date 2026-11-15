import type { ChatMessage } from '@/types';

// Rough per-message overhead for role headers / separators added by templates.
export const PER_MESSAGE_OVERHEAD = 8;
// Slack for BOS/generation-prompt tokens the template adds.
const SAFETY_MARGIN = 16;

/**
 * Drop the oldest non-system messages until the prompt fits in the context
 * window with room left for the reply. The system prompt and the latest
 * message are always kept, and the kept history never opens on an assistant
 * turn.
 */
export async function fitToContext(
  messages: ChatMessage[],
  nCtx: number,
  nPredict: number,
  countTokens: (text: string) => Promise<number>,
): Promise<{ messages: ChatMessage[]; dropped: number }> {
  const budget = nCtx - nPredict - SAFETY_MARGIN;
  const system = messages[0]?.role === 'system' ? messages[0] : null;
  const history = system ? messages.slice(1) : messages.slice();

  const counts = await Promise.all(history.map((m) => countTokens(m.content)));
  let total = (system ? (await countTokens(system.content)) + PER_MESSAGE_OVERHEAD : 0)
    + counts.reduce((a, n) => a + n + PER_MESSAGE_OVERHEAD, 0);

  let start = 0;
  while (total > budget && start < history.length - 1) {
    total -= counts[start]! + PER_MESSAGE_OVERHEAD;
    start++;
  }
  while (start < history.length - 1 && history[start]!.role === 'assistant') start++;

  const kept = history.slice(start);
  return { messages: system ? [system, ...kept] : kept, dropped: start };
}
