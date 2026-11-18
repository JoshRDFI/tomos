// Auto-compaction planning: which summary applies on the current branch,
// which messages to condense, and what a continued chat carries over. Pure.
import { PER_MESSAGE_OVERHEAD } from './contextWindow';
import type { ChatMessage, Summary } from '@/types';

/** Compact after a reply when the prompt is over this share of the budget… */
export const COMPACT_TRIGGER = 0.7;
/** …condensing the oldest messages until it is at most this share. */
export const COMPACT_TARGET = 0.4;
/** Always keep at least the last two exchanges word for word. */
export const KEEP_MIN = 4;
export const SUMMARY_N_PREDICT = 400;
export const SUMMARY_MAX_TEMP = 0.5;
/** Suggest "Continue in a new chat" after this many summaries on a path. */
export const CONTINUE_HINT_AFTER = 3;

export const SUMMARY_INSTRUCTION =
  'Summarize the conversation so far for your own later reference. Include the topics, decisions, facts the user shared, open questions, and anything you promised to do. Write at most 200 words, plain prose, no preamble.';

/** Summaries whose last covered message is on `path`, oldest first. */
export function summariesOnPath(summaries: Summary[], path: { id: string }[]): Summary[] {
  const ids = new Set(path.map((m) => m.id));
  return summaries.filter((s) => ids.has(s.throughMessageId)).sort((a, b) => a.createdAt - b.createdAt);
}

/** The newest summary on this branch; an edit before it leaves it off the path. */
export function activeSummary(summaries: Summary[], path: { id: string }[]): Summary | null {
  const on = summariesOnPath(summaries, path);
  return on[on.length - 1] ?? null;
}

/** The path messages the model sees word for word (after the summary). */
export function messagesAfter<T extends { id: string }>(path: T[], summary: Summary | null): T[] {
  if (!summary) return path;
  const i = path.findIndex((m) => m.id === summary.throughMessageId);
  return i < 0 ? path : path.slice(i + 1);
}

/**
 * Which of `counts`/`roles` (the messages after the summary) to condense:
 * indexes 0..throughIndex. Null when under the trigger or nothing can go.
 */
/**
 * The path messages the chat prompt sends after the system message: those
 * after the active summary, without a leading persona greeting (that goes in
 * the system message; some templates reject a conversation that opens with
 * an assistant turn).
 */
export function promptPath<T extends { id: string; kind?: string | null }>(path: T[], summaries: Summary[]): T[] {
  const after = messagesAfter(path, activeSummary(summaries, path));
  return after[0]?.kind === 'greeting' ? after.slice(1) : after;
}

export function planCompaction(o: {
  fixedTokens: number;
  counts: number[];
  roles: ('user' | 'assistant')[];
  budget: number;
  trigger?: number;
}): { throughIndex: number } | null {
  const n = o.counts.length;
  const cost = (i: number) => o.counts[i]! + PER_MESSAGE_OVERHEAD;
  let total = o.fixedTokens;
  for (let i = 0; i < n; i++) total += cost(i);
  if (total <= (o.trigger ?? COMPACT_TRIGGER) * o.budget) return null;

  // First kept message.
  let k = 0;
  while (n - k > KEEP_MIN && total > COMPACT_TARGET * o.budget) total -= cost(k++);
  if (o.roles[k] !== 'user') {
    let fwd = k;
    while (fwd < n && o.roles[fwd] !== 'user') fwd++;
    if (fwd < n && n - fwd >= KEEP_MIN) k = fwd;
    else {
      while (k > 0 && o.roles[k] !== 'user') k--;
    }
  }
  return k > 0 ? { throughIndex: k - 1 } : null;
}

/** The chat's own prompt prefix, then the instruction: only the tail is new to the model. */
export function summaryRequest(system: string, condensed: ChatMessage[]): ChatMessage[] {
  return [{ role: 'system', content: system }, ...condensed, { role: 'user', content: SUMMARY_INSTRUCTION }];
}

/** What a continued chat starts with: the summary, then the last exchanges (oldest dropped first to fit). */
export function buildCarryOver(summary: string | null, recent: ChatMessage[], maxTokens: number, count: (s: string) => number): string {
  const label = (m: ChatMessage) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
  let turns = recent.filter((m) => m.role !== 'system');
  const compose = () => [summary?.trim(), turns.map(label).join('\n')].filter(Boolean).join('\n\n');
  let text = compose();
  while (turns.length > 0 && count(text) > maxTokens) {
    turns = turns.slice(1);
    text = compose();
  }
  return text;
}
