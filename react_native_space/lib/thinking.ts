/**
 * Separating a reasoning model's thinking from its answer.
 *
 * With a built-in (jinja) chat template, llama.rn parses the output itself and
 * reports `reasoning_content` and `content` separately. This module is the
 * fallback for everything else: manual templates, formats llama.cpp doesn't
 * recognise, and replies saved before thinking was split out.
 */

const TAGS: { open: string; close: string }[] = [
  { open: '<think>', close: '</think>' },
  { open: '<thinking>', close: '</thinking>' },
  { open: '[THINK]', close: '[/THINK]' },
];

export interface ThinkingSplit {
  thinking: string;
  answer: string;
  /** True while the thinking block hasn't been closed yet. */
  open: boolean;
}

/**
 * Split a leading thinking block off `raw`. Handles:
 * - `<think>…</think>answer` (and the other tag styles above);
 * - an unclosed block while streaming (`<think>still going`);
 * - templates that open the block in the prompt, so the output only contains
 *   the closing tag (`reasoning…</think>answer`);
 * - a tag that has only partly arrived (`<thi`).
 * Only a block at the start counts; tags later in an answer are left alone.
 */
export function splitThinking(raw: string): ThinkingSplit {
  const lead = raw.length - raw.trimStart().length;
  const body = raw.slice(lead);

  for (const { open, close } of TAGS) {
    if (body.startsWith(open)) {
      const rest = body.slice(open.length);
      const end = rest.indexOf(close);
      if (end < 0) return { thinking: rest.trim(), answer: '', open: true };
      return { thinking: rest.slice(0, end).trim(), answer: rest.slice(end + close.length).trim(), open: false };
    }
    // Partially streamed opening tag: nothing to show yet.
    if (body.length > 0 && body.length < open.length && open.startsWith(body)) {
      return { thinking: '', answer: '', open: true };
    }
  }

  // Opened by the template: only the closing tag appears in the output.
  for (const { open, close } of TAGS) {
    const end = body.indexOf(close);
    if (end >= 0 && !body.slice(0, end).includes(open)) {
      return { thinking: body.slice(0, end).trim(), answer: body.slice(end + close.length).trim(), open: false };
    }
  }

  return { thinking: '', answer: raw, open: false };
}

/** What has streamed so far, as reported by llama.rn. */
export interface StreamState {
  /** All token text received. */
  raw: string;
  /** llama.rn's parsed thinking/answer (null until it reports any). */
  nativeThinking: string | null;
  nativeContent: string | null;
}

export interface StreamView {
  thinking: string;
  answer: string;
  /** Still inside the thinking block. */
  thinkingOpen: boolean;
}

/**
 * Thinking and answer to show. Prefers llama.rn's own parse; falls back to
 * splitting tags when it reports no thinking. With `split` off
 * (reasoning_format 'none') the output is shown as-is.
 */
export function resolveStreamView(st: StreamState, split: boolean): StreamView {
  const usedNative = st.nativeThinking !== null || st.nativeContent !== null;
  const thinking = usedNative ? (st.nativeThinking ?? '').trim() : '';
  const answer = usedNative ? (st.nativeContent ?? '') : st.raw;
  if (thinking || !split) {
    return { thinking, answer: answer.trimStart(), thinkingOpen: !!thinking && !answer.trim() };
  }
  const s = splitThinking(answer);
  return { thinking: s.thinking, answer: s.answer.trimStart(), thinkingOpen: s.open };
}

/** "Thought for 12 s" / "1 min 5 s". */
export function formatThinkingTime(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
