// Editing a model reply. Pure.
import type { MessageRecord } from '@/types';

/**
 * A new version of `original` holding `text`, beside the original like a
 * regenerated reply. Thinking and stats described the old text, so they go.
 */
export function editedReply(original: MessageRecord, text: string, id: string, now: number): MessageRecord {
  const { versions: _versions, ...rest } = original;
  return {
    ...rest,
    id,
    content: text.trim(),
    createdAt: now,
    reasoning: null,
    thinkingMs: null,
    tokenCount: null,
    tokensPerSec: null,
    stopped: 0,
  };
}
