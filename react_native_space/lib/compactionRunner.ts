// Runs auto-compaction: after a reply, if the chat's prompt is getting full,
// the loaded model condenses the oldest messages into a summary.
import * as db from './db';
import * as llama from './llama';
import { prepareModel } from './modelMeta';
import { toChatMessages } from './prompt';
import { splitThinking } from './thinking';
import {
  activeSummary, buildCarryOver, promptPath, CARRY_OVER_SHARE, planCompaction, summaryRequest, SUMMARY_MAX_TEMP, SUMMARY_N_PREDICT,
} from './compaction';
import { estimateTokens } from './personas';
import { DEFAULT_N_CTX } from './params';
import type { ModelRecord, Summary } from '@/types';

/**
 * Condense the oldest messages of `sessionId` if its prompt is over the
 * trigger. Returns the saved summary, or null when nothing was needed, it was
 * stopped (a send, a chat or model switch), or the model wrote nothing usable.
 */
export async function compactIfNeeded(
  sessionId: string,
  model: ModelRecord,
  opts?: { onStart?: () => void; trigger?: number; target?: number; keepMin?: number; cancel?: { stop: boolean } },
): Promise<Summary | null> {
  const cancel = opts?.cancel ?? { stop: false };
  const session = await db.getSession(sessionId);
  if (!session) return null;
  const path = await db.getSessionMessages(sessionId);
  // Exactly the messages the chat prompt sends after the system message.
  const after = promptPath(path, await db.getSummaries(sessionId));
  if (after.length === 0) return null;

  // The same system message as the chat's own prompt, so the request shares its prefix.
  const system = await db.buildSystemMessage(session, path);
  const chat = toChatMessages(after);
  const { completion } = await prepareModel(model, session);
  const counts = await Promise.all(chat.map((m) => llama.countTokens(m.content)));
  const plan = planCompaction({
    fixedTokens: await llama.countTokens(system),
    counts,
    roles: chat.map((m) => (m.role === 'user' ? 'user' : 'assistant')),
    budget: llama.promptBudget(completion),
    trigger: opts?.trigger,
    target: opts?.target,
    keepMin: opts?.keepMin,
  });
  if (!plan || cancel.stop) return null;

  opts?.onStart?.();
  const temp = Number(completion.temperature);
  // Some templates read thinking from chat_template_kwargs; turn it off there too.
  const kwargs = completion.chat_template_kwargs;
  let result;
  try {
    result = await llama.generate(
      model,
      summaryRequest(system, chat.slice(0, plan.throughIndex + 1)),
      {
        ...completion,
        enable_thinking: false,
        ...(kwargs && typeof kwargs === 'object' ? { chat_template_kwargs: { ...(kwargs as object), enable_thinking: false } } : {}),
        // A summary must repeat the conversation's names and phrases: no penalties for that.
        dry_multiplier: 0,
        penalty_present: 0,
        penalty_freq: 0,
        n_predict: SUMMARY_N_PREDICT,
        temperature: Math.min(Number.isFinite(temp) ? temp : 0.8, SUMMARY_MAX_TEMP),
      },
      () => {},
      undefined,
      { label: 'compaction', stopRef: cancel },
    );
  } catch (e) {
    console.warn('Compaction failed', e);
    return null;
  }
  // Only a complete summary of every condensed message is worth keeping: not
  // one that was stopped, hit the length limit, ran on a model swapped in
  // meanwhile, or had messages dropped to fit.
  const notSaved = (why: string) => { console.log(`[gen] compaction: not saved (${why})`); return null; };
  if (result.stopped || cancel.stop) return notSaved('stopped');
  if (result.cutOff) return notSaved('hit the length limit');
  if (result.droppedMessages > 0) return notSaved(`${result.droppedMessages} messages didn't fit`);
  if (llama.getLoadedModelId() !== model.id) return notSaved('model changed');
  const text = splitThinking(result.content).answer.trim();
  if (!text) return notSaved('empty');

  const summary: Summary = {
    id: db.generateId(),
    sessionId,
    throughMessageId: after[plan.throughIndex]!.id,
    content: text,
    tokenCount: result.tokenCount,
    modelName: model.displayName,
    createdAt: Date.now(),
  };
  await db.insertSummary(summary);
  return summary;
}

/** Budget used for carry-over when no model is loaded (the app's default context). */
const FALLBACK_BUDGET = DEFAULT_N_CTX - 1024 - 16;

/**
 * What "Continue in a new chat" carries over: the chat's summary and the
 * messages after it, word for word, in at most 20% of the space so the new
 * chat has room. With a model loaded, everything but the last exchange is
 * condensed first; anything still too long loses its oldest messages.
 */
export async function prepareContinuation(
  sessionId: string,
  model: ModelRecord | null,
  opts?: { onStart?: () => void; cancel?: { stop: boolean } },
): Promise<string> {
  const fresh = model ? await compactIfNeeded(sessionId, model, { onStart: opts?.onStart, trigger: CARRY_OVER_SHARE, target: CARRY_OVER_SHARE, keepMin: 2, cancel: opts?.cancel }) : null;
  const path = await db.getSessionMessages(sessionId);
  const summary = fresh ?? activeSummary(await db.getSummaries(sessionId), path);
  let budget = FALLBACK_BUDGET;
  if (model) {
    const session = await db.getSession(sessionId);
    budget = llama.promptBudget((await prepareModel(model, session)).completion);
  }
  return buildCarryOver(summary?.content ?? null, toChatMessages(promptPath(path, summary ? [summary] : [])), CARRY_OVER_SHARE * budget, estimateTokens);
}
