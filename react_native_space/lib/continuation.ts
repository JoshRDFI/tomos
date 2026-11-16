/**
 * Continuing a reply that was stopped or cut off by the length limit.
 *
 * The chat is formatted up to the assistant's turn as usual, then the partial
 * reply is appended verbatim, so the model carries on from where it stopped
 * (in its thinking, or in the answer).
 */
import { splitThinking } from './thinking';

export interface Partial {
  /** Answer so far. */
  content: string;
  /** Thinking so far ('' if none). */
  reasoning: string;
}

export interface ThinkTags {
  start: string;
  end: string;
}

export const DEFAULT_THINK_TAGS: ThinkTags = { start: '<think>', end: '</think>' };

export interface Continuation {
  /** Text appended to the formatted prompt. */
  promptSuffix: string;
  /** Text that, with the new output appended, splits into thinking and answer. */
  displayPrefix: string;
}

/**
 * @param forcedOpen the template's generation prompt already opens the
 *   thinking block (so the start tag must not be repeated).
 */
export function buildContinuation(p: Partial, tags: ThinkTags = DEFAULT_THINK_TAGS, forcedOpen = false): Continuation {
  if (!p.reasoning) return { promptSuffix: p.content, displayPrefix: p.content };
  const closed = p.content ? `${tags.end}\n\n${p.content}` : '';
  return {
    promptSuffix: `${forcedOpen ? '' : tags.start}${p.reasoning}${closed}`,
    displayPrefix: `${tags.start}${p.reasoning}${closed}`,
  };
}

/** Thinking and answer after `output` was generated as a continuation. */
export function splitContinued(displayPrefix: string, output: string): { thinking: string; answer: string; open: boolean } {
  return splitThinking(displayPrefix + output);
}
