// Runs auto-compaction: after a reply, if the chat's prompt is getting full,
// the loaded model condenses the oldest messages into a summary.
import * as db from './db';
import * as llama from './llama';
import { prepareModel } from './modelMeta';
import { toChatMessages } from './prompt';
import { splitThinking } from './thinking';
import {
  activeSummary, buildCarryOver, COMPACT_TARGET, messagesAfter, planCompaction, summaryRequest, SUMMARY_MAX_TEMP, SUMMARY_N_PREDICT,
} from './compaction';
import { estimateTokens } from './personas';
import type { ModelRecord, Summary } from '@/types';

/**
 * Condense the oldest messages of `sessionId` if its prompt is over the
 * trigger. Returns the saved summary, or null when nothing was needed, it was
 * stopped (a send, a chat or model switch), or the model wrote nothing usable.
 */
export async function compactIfNeeded(
  sessionId: string,
  model: ModelRecord,
  opts?: { onStart?: () => void; trigger?: number },
): Promise<Summary | null> {
  const session = await db.getSession(sessionId);
  if (!session) return null;
  const path = await db.getSessionMessages(sessionId);
  const after = messagesAfter(path, activeSummary(await db.getSummaries(sessionId), path));
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
  });
  if (!plan) return null;

  opts?.onStart?.();
  const temp = Number(completion.temperature);
  let result;
  try {
    result = await llama.generate(
      model,
      summaryRequest(system, chat.slice(0, plan.throughIndex + 1)),
      {
        ...completion,
        enable_thinking: false,
        n_predict: SUMMARY_N_PREDICT,
        temperature: Math.min(Number.isFinite(temp) ? temp : 0.8, SUMMARY_MAX_TEMP),
      },
      () => {},
      undefined,
      { label: 'compaction' },
    );
  } catch (e) {
    console.warn('Compaction failed', e);
    return null;
  }
  if (result.stopped) return null;
  const text = splitThinking(result.content).answer.trim();
  if (!text) return null;

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
const FALLBACK_BUDGET = 4096 - 2048 - 16;

/**
 * What "Continue in a new chat" carries over: the chat's summary and the
 * messages after it, word for word. A long tail is condensed first (40%
 * trigger) when a model is loaded; anything still too long loses its oldest
 * messages.
 */
export async function prepareContinuation(
  sessionId: string,
  model: ModelRecord | null,
  opts?: { onStart?: () => void },
): Promise<string> {
  const fresh = model ? await compactIfNeeded(sessionId, model, { onStart: opts?.onStart, trigger: COMPACT_TARGET }) : null;
  const path = await db.getSessionMessages(sessionId);
  const summary = fresh ?? activeSummary(await db.getSummaries(sessionId), path);
  let budget = FALLBACK_BUDGET;
  if (model) {
    const session = await db.getSession(sessionId);
    budget = llama.promptBudget((await prepareModel(model, session)).completion);
  }
  return buildCarryOver(summary?.content ?? null, toChatMessages(messagesAfter(path, summary)), COMPACT_TARGET * budget, estimateTokens);
}
