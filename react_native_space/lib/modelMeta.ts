import type { ModelRecord, SessionRecord } from '@/types';
import * as db from './db';
import { loadModelInfo } from './llama';
import { extractFileParams, splitParams } from './params';

/**
 * Make sure the model's recommended settings from its GGUF metadata have been
 * read and saved. Models imported before this existed have fileParams = null;
 * they get read once, on first use. Returns the (possibly updated) record.
 */
export async function ensureFileParams(model: ModelRecord): Promise<ModelRecord> {
  if (model.fileParams != null) return model;
  const info = await loadModelInfo(model.filePath);
  if (!info) return model; // web, or unreadable: try again next time
  const fileParams = JSON.stringify(extractFileParams(info));
  await db.updateModel(model.id, { fileParams });
  return { ...model, fileParams };
}

/**
 * Re-read the model from the database (its settings may have been edited on
 * another screen), make sure its file recommendations are known, and work out
 * the effective settings for `session`, split into load-time and per-reply.
 */
export async function prepareModel(model: ModelRecord, session: SessionRecord | null) {
  const fresh = await ensureFileParams((await db.getModel(model.id)) ?? model);
  const resolved = await db.getEffectiveParams(session, fresh);
  const { load, completion } = splitParams(resolved.values);
  return { model: fresh, load, completion };
}
