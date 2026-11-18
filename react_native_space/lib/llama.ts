import { Platform } from 'react-native';
import type { ChatMessage, ModelRecord } from '@/types';
import { loadSignature, type ParamSet } from './params';
import { formatPrompt } from './templates';
import { resolveStreamView, type StreamState, type StreamView } from './thinking';
import { buildContinuation, DEFAULT_THINK_TAGS, splitContinued, type Partial as PartialReply } from './continuation';
import { fitToContext } from './contextWindow';

let _context: any = null;
let _loadedModelId: string | null = null;
let _loadedParams: ParamSet | null = null;

// The completion currently running on _context, if any. Releasing the native
// context while a completion is in flight crashes, so release waits on this.
let _inflight: Promise<unknown> | null = null;

export const isNative = Platform.OS !== 'web';

/** Load `model` with the given load-time llama.rn parameters (n_ctx, n_threads, ...). */
export async function loadModel(model: ModelRecord, loadParams: ParamSet): Promise<void> {
  if (!isNative) return;
  await releaseModel();
  const { initLlama } = await import('llama.rn');
  _context = await initLlama({
    use_mlock: false,
    ...(loadParams as object),
    model: model.filePath,
  } as any);
  _loadedModelId = model.id;
  _loadedParams = { ...loadParams };
}

export async function releaseModel(): Promise<void> {
  if (_context) {
    if (_inflight) {
      interrupt(_context);
      try { await _inflight; } catch {}
    }
    try { await _context.release(); } catch {}
    _context = null;
  }
  _loadedModelId = null;
  _loadedParams = null;
}

export function getLoadedModelId(): string | null {
  return _loadedModelId;
}

/** Identity of the load parameters currently in effect, or null if nothing is loaded. */
export function getLoadedSignature(): string | null {
  return _loadedParams ? loadSignature(_loadedParams) : null;
}

export async function loadModelInfo(filePath: string): Promise<Record<string, any> | null> {
  if (!isNative) return null;
  try {
    const { loadLlamaModelInfo } = await import('llama.rn');
    return await loadLlamaModelInfo(filePath);
  } catch {
    return null;
  }
}

let _stopRef: { stop: boolean } = { stop: false };

/** Generation milestones in logcat (tag ReactNativeJS), for diagnosing stalls. */
function log(msg: string) {
  console.log(`[gen] ${msg}`);
}

export function stopGeneration() {
  log(`stop requested (running: ${!!_inflight})`);
  _stopRef.stop = true;
  // Actually interrupt native generation; the completion promise then resolves
  // promptly with what was produced so far.
  if (_context && _inflight) interrupt(_context);
}

/**
 * Ask llama.rn to stop the running completion. Its JSI stopCompletion returns
 * undefined, not the Promise its types promise, so never chain on the result.
 */
function interrupt(ctx: any) {
  try {
    void Promise.resolve(ctx.stopCompletion()).catch(() => {});
  } catch {}
}

export interface GenerateResult {
  /** The answer, without thinking. */
  content: string;
  /** The model's thinking, separated from the answer ('' if none). */
  reasoning: string;
  /** Time from the first thinking token to the start of the answer. */
  thinkingMs: number | null;
  tokenCount: number;
  tokensPerSec: number;
  stopped: boolean;
  /** Ended at the length limit (n_predict) or a full context, mid-reply. */
  cutOff: boolean;
  /** Number of oldest history messages left out to fit the context window. */
  droppedMessages: number;
}

export type { StreamView } from './thinking';

export async function countTokens(text: string): Promise<number> {
  try {
    const res = await _context.tokenize(text);
    return res?.tokens?.length ?? Math.ceil(text.length / 3);
  } catch {
    // Conservative fallback (~3 chars per token)
    return Math.ceil(text.length / 3);
  }
}

export async function generate(
  model: ModelRecord,
  messages: ChatMessage[],
  /** Per-completion llama.rn parameters (temperature, top_k, n_predict, ...). */
  params: ParamSet,
  /** Called as the reply streams in, with the thinking and answer so far. */
  onUpdate: (view: StreamView) => void,
  /**
   * Continue this partial reply instead of starting a new one. The result
   * then holds the whole reply (old + new); token counts cover the new part.
   */
  prefill?: PartialReply,
): Promise<GenerateResult> {
  if (!isNative || !_context) {
    throw new Error('Model not loaded');
  }
  if (_inflight) {
    throw new Error('A response is already being generated');
  }

  _stopRef = { stop: false };
  const stopRef = _stopRef;
  const ctx = _context;

  const nCtx = Number(_loadedParams?.n_ctx) || 512;
  // Never ask for more output than leaves room for at least some prompt.
  // n_predict <= 0 means "no limit" in llama.cpp; cap it the same way.
  const requested = Number(params.n_predict);
  const half = Math.floor(nCtx / 2);
  const nPredict = Math.max(16, requested > 0 ? Math.min(requested, half) : half);
  // A continuation's partial reply is part of the prompt, so count it too.
  const toFit = prefill
    ? [...messages, { role: 'assistant' as const, content: `${prefill.reasoning}\n${prefill.content}` }]
    : messages;
  const fit = await fitToContext(toFit, nCtx, nPredict, countTokens);
  const fitted = prefill ? fit.messages.slice(0, -1) : fit.messages;
  const dropped = fit.dropped;

  const templateKey = model.templateOverride ?? 'auto';
  const hasJinjaTemplate = model.detectedTemplate === 'auto-available' || !!_loadedParams?.chat_template;
  const useJinja = templateKey === 'auto' && hasJinjaTemplate;

  // Everything the user configured passes straight through to llama.rn.
  const sampling = { ...params, n_predict: nPredict };

  // Thinking vs answer. With a jinja template llama.rn parses the output and
  // reports reasoning_content/content on every token (only when non-empty);
  // otherwise, or when it finds no thinking, split <think> tags ourselves.
  // reasoning_format 'none' means: show the raw output, don't split.
  const splitEnabled = params.reasoning_format !== 'none';
  const st: StreamState = { raw: '', nativeThinking: null, nativeContent: null };
  // Set below for a continuation: the old reply, in the form the output continues.
  let displayPrefix: string | null = null;
  const view = (): StreamView => {
    if (displayPrefix === null) return resolveStreamView(st, splitEnabled);
    if (!splitEnabled) return { thinking: prefill?.reasoning ?? '', answer: (prefill?.content ?? '') + st.raw, thinkingOpen: false };
    const s = splitContinued(displayPrefix, st.raw);
    return { thinking: s.thinking, answer: s.answer, thinkingOpen: s.open };
  };

  let firstTokenAt: number | null = null;
  let answerAt: number | null = null;
  let last: StreamView = { thinking: '', answer: '', thinkingOpen: false };
  const startedAt = Date.now();
  let tokens = 0;
  const onData = (data: any) => {
    if (stopRef.stop) return;
    const now = Date.now();
    if (firstTokenAt === null) {
      firstTokenAt = now;
      log(`first token after ${now - startedAt} ms`);
    }
    if (++tokens % 200 === 0) log(`${tokens} tokens`);
    if (typeof data?.token === 'string') st.raw += data.token;
    // A continuation is a raw prompt; llama.rn has no chat parse for it.
    if (displayPrefix === null) {
      if (typeof data?.reasoning_content === 'string') st.nativeThinking = data.reasoning_content;
      if (typeof data?.content === 'string') st.nativeContent = data.content;
    }
    last = view();
    if (answerAt === null && last.answer.trim()) answerAt = now;
    onUpdate(last);
  };

  const userStop = Array.isArray(params.stop) ? (params.stop as unknown[]).filter((x) => typeof x === 'string') as string[] : [];
  let request: any;
  if (prefill) {
    // Format the chat up to the assistant's turn, then append the partial
    // reply so the model carries on from it.
    let prompt: string;
    let stop: string[];
    let tags = DEFAULT_THINK_TAGS;
    let forcedOpen = false;
    if (useJinja) {
      const formatted: any = await ctx.getFormattedChat(
        fitted.map((m) => ({ role: m.role, content: m.content })),
        null,
        { jinja: true, add_generation_prompt: true, enable_thinking: params.enable_thinking as boolean | undefined, chat_template_kwargs: params.chat_template_kwargs as any },
      );
      prompt = formatted.prompt ?? '';
      stop = formatted.additional_stops ?? [];
      if (formatted.thinking_start_tag && formatted.thinking_end_tag) tags = { start: formatted.thinking_start_tag, end: formatted.thinking_end_tag };
      forcedOpen = !!formatted.thinking_forced_open;
    } else {
      const f = formatPrompt(templateKey === 'auto' ? 'chatml' : templateKey, fitted);
      prompt = f.prompt;
      stop = f.stop;
    }
    const cont = buildContinuation(prefill, tags, forcedOpen);
    displayPrefix = cont.displayPrefix;
    // If stopped before any new token, keep the old reply as it was.
    last = view();
    const { reasoning_format: _rf, enable_thinking: _et, chat_template_kwargs: _ck, ...rest } = sampling as any;
    request = { ...rest, prompt: prompt + cont.promptSuffix, stop: [...stop, ...userStop] };
  } else if (useJinja) {
    request = {
      ...sampling,
      messages: fitted.map((m) => ({ role: m.role, content: m.content })),
      jinja: true,
    };
    // Ask llama.rn to separate thinking unless the user chose otherwise.
    if (request.reasoning_format === undefined) request.reasoning_format = 'auto';
  } else {
    const effectiveKey = templateKey === 'auto' ? 'chatml' : templateKey;
    const { prompt, stop } = formatPrompt(effectiveKey, fitted);
    request = { ...sampling, prompt, stop: [...stop, ...userStop] };
  }

  log(`start: n_ctx=${nCtx} n_predict=${nPredict} prompt≈${fit.tokens} tokens, ${fitted.length} messages, dropped=${dropped}, continue=${!!prefill}`);
  // Until the first token, llama.cpp is reading the prompt; on a long chat
  // after a restart (nothing cached) that can take minutes on a phone.
  onUpdate({ ...last, status: `Reading the conversation (about ${fit.tokens.toLocaleString()} tokens)…` });
  const run = ctx.completion(request, onData);
  _inflight = run;
  let result: any;
  try {
    result = await run;
  } catch (e) {
    log(`failed: ${String((e as any)?.message ?? e)}`);
    throw e;
  } finally {
    _inflight = null;
  }
  const t = result?.timings ?? {};
  log(`end after ${Date.now() - startedAt} ms: stopped=${stopRef.stop} limit=${!!result?.stopped_limit} context_full=${!!result?.context_full} eos=${!!result?.stopped_eos} prompt_n=${t.prompt_n} prompt_ms=${Math.round(t.prompt_ms ?? 0)} predicted_n=${t.predicted_n} tok/s=${(t.predicted_per_second ?? 0).toFixed(1)}`);

  // When stopped, keep exactly what the user saw rather than the full native
  // result, which can include tokens produced after the stop request.
  let final = last;
  if (!stopRef.stop && result && displayPrefix !== null) {
    if (typeof result.text === 'string' && result.text.length >= st.raw.length) st.raw = result.text;
    final = view();
  } else if (!stopRef.stop && result) {
    if (typeof result.reasoning_content === 'string' && result.reasoning_content) st.nativeThinking = result.reasoning_content;
    if (typeof result.content === 'string' && (result.content || st.nativeContent !== null)) st.nativeContent = result.content;
    if (st.nativeThinking === null && st.nativeContent === null && typeof result.text === 'string') st.raw = result.text;
    const v = view();
    // Never lose text that was already on screen.
    final = v.answer.trim() || !last.answer.trim() ? v : last;
  }
  const thinkingMs = final.thinking && firstTokenAt !== null
    ? (answerAt ?? Date.now()) - firstTokenAt
    : null;

  return {
    content: final.answer.trim(),
    reasoning: final.thinking,
    thinkingMs,
    tokenCount: result?.timings?.predicted_n ?? 0,
    tokensPerSec: result?.timings?.predicted_per_second ?? 0,
    stopped: stopRef.stop,
    cutOff: !stopRef.stop && (!!result?.stopped_limit || !!result?.context_full),
    droppedMessages: dropped,
  };
}
