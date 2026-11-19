// Personas: which instructions a chat uses, and helpers around them. Pure.
import { splitParams, type ParamSet } from './params';
import type { MessageRecord, Persona, SessionRecord } from '@/types';

export type InstructionSource =
  | { kind: 'custom'; text: string }
  | { kind: 'persona'; persona: Persona }
  | { kind: 'default'; text: string };

/** Custom text, else the chat's persona, else the default system prompt. A deleted persona falls through. */
export function resolveInstructions(
  session: Pick<SessionRecord, 'systemPromptOverride' | 'personaId'> | null,
  personas: Persona[],
  defaultPrompt: string,
): InstructionSource {
  if (session?.systemPromptOverride != null) return { kind: 'custom', text: session.systemPromptOverride };
  const persona = session?.personaId ? personas.find((p) => p.id === session.personaId) : undefined;
  if (persona) return { kind: 'persona', persona };
  return { kind: 'default', text: defaultPrompt };
}

/** The persona new chats start with, if the saved default still exists. */
export function pickDefaultPersona(defaultId: string | null, personas: Persona[]): Persona | null {
  if (!defaultId) return null;
  return personas.find((p) => p.id === defaultId) ?? null;
}

/** Personas carry per-completion settings only; switching persona never reloads the model. */
export function completionParamsOnly(set: ParamSet): ParamSet {
  return splitParams(set).completion;
}

/** A chat is "empty" until the user has sent something (a greeting doesn't count). */
export function isChatEmpty(messages: Pick<MessageRecord, 'role'>[]): boolean {
  return !messages.some((m) => m.role === 'user');
}

export function uniqueName(name: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`)) return `${name} (${n})`;
}

/** Rough token count when no tokenizer is loaded. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Migration: chats (and the default prompt) whose text is an exact copy of a
 * preset get linked to it. When several presets share the text, the oldest wins.
 */
export function linkExactCopies(
  personas: Pick<Persona, 'id' | 'content' | 'createdAt'>[],
  sessions: Pick<SessionRecord, 'id' | 'systemPromptOverride'>[],
  defaultPrompt: string | null,
): { sessionLinks: { sessionId: string; personaId: string }[]; defaultPersonaId: string | null } {
  const byText = new Map<string, string>();
  for (const p of [...personas].sort((a, b) => a.createdAt - b.createdAt)) if (!byText.has(p.content)) byText.set(p.content, p.id);
  const sessionLinks: { sessionId: string; personaId: string }[] = [];
  for (const s of sessions) {
    const id = s.systemPromptOverride != null ? byText.get(s.systemPromptOverride) : undefined;
    if (id) sessionLinks.push({ sessionId: s.id, personaId: id });
  }
  return { sessionLinks, defaultPersonaId: defaultPrompt != null ? (byText.get(defaultPrompt) ?? null) : null };
}

/** A persona with only instructions (what a preset was). */
export function blankPersona(p: Pick<Persona, 'id' | 'name' | 'content' | 'createdAt'>): Persona {
  return { greeting: null, examples: [], params: {}, updatedAt: p.createdAt, ...p };
}
