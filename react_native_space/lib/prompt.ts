// Building what the model is sent. Pure.
import { withDate } from './dateContext';
import { splitThinking } from './thinking';
import type { ChatMessage, MessageRecord, PersonaExample } from '@/types';

export const EXAMPLES_HEADER = 'Examples of how you reply:';
export const SUMMARY_HEADER = 'Summary of the earlier part of this conversation:';
export const CARRY_OVER_HEADER = 'Earlier conversation (continued from another chat):';

export function formatExamples(examples: PersonaExample[]): string {
  if (!examples.length) return '';
  return `${EXAMPLES_HEADER}\n${examples.map((e) => `User: ${e.user}\nAssistant: ${e.assistant}`).join('\n\n')}`;
}

/**
 * The system message: instructions (with the date), persona examples, then
 * the summary of condensed messages, or the carry-over when there is no
 * summary (a continued chat's first summary already covers its carry-over).
 */
export function composeSystemMessage(p: {
  instructions: string;
  date: Date | null;
  examples: PersonaExample[];
  summary: string | null;
  carryOver: string | null;
}): string {
  const blocks = [p.date ? withDate(p.instructions, p.date) : p.instructions.trim()];
  const examples = formatExamples(p.examples);
  if (examples) blocks.push(examples);
  if (p.summary) blocks.push(`${SUMMARY_HEADER}\n${p.summary}`);
  else if (p.carryOver) blocks.push(`${CARRY_OVER_HEADER}\n${p.carryOver}`);
  return blocks.filter(Boolean).join('\n\n');
}

/**
 * Path messages as the model sees them. Thinking isn't sent back, only
 * answers; replies saved before thinking was split out still carry their tags.
 */
export function toChatMessages(path: MessageRecord[]): ChatMessage[] {
  return path.map((m) => ({
    role: m.role,
    content: m.role === 'assistant' && !m.reasoning ? splitThinking(m.content ?? '').answer : (m.content ?? ''),
  }));
}
