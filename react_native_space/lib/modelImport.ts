// Turn a GGUF file already in app storage into a saved model: read its
// metadata, chat template and recommended settings. Shared by import
// (copy from the picker) and download (Hugging Face).
import * as db from './db';
import { parseQuantFromFilename } from './gguf';
import * as llama from './llama';
import { extractFileParams } from './params';
import type { ModelRecord } from '@/types';

export async function finishModel(o: {
  id: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  /** Quant label from the GGUF header (general.file_type), if known. */
  fileType: string | null;
}): Promise<ModelRecord> {
  let displayName = o.fileName.replace(/\.gguf$/i, '');
  let architecture: string | null = null;
  let parameterLabel: string | null = null;
  let detectedTemplate: string | null = null;
  let trainedContext: number | null = null;
  let fileParams: string | null = null;

  try {
    const info = await llama.loadModelInfo(o.filePath);
    if (info) {
      displayName = info['general.name'] ?? displayName;
      architecture = info['general.architecture'] ?? null;
      parameterLabel = info['general.size_label'] ?? null;
      if (info['tokenizer.chat_template']) detectedTemplate = 'auto-available';
      const arch = architecture?.toLowerCase?.() ?? '';
      const ctxLen = Number(info[`${arch}.context_length`]);
      trainedContext = Number.isFinite(ctxLen) && ctxLen > 0 ? ctxLen : null;
      fileParams = JSON.stringify(extractFileParams(info));
    }
  } catch (e) {
    // Metadata is an enhancement; the model still loads without it.
    console.warn('Metadata read failed', e);
  }

  const model: ModelRecord = {
    id: o.id,
    displayName,
    fileName: o.fileName,
    filePath: o.filePath,
    fileSizeBytes: o.fileSizeBytes,
    quantization: parseQuantFromFilename(o.fileName) ?? o.fileType ?? null,
    architecture,
    parameterLabel,
    detectedTemplate,
    templateOverride: 'auto',
    trainedContext,
    addedAt: Date.now(),
    fileParams,
    paramsOverride: null,
  };
  await db.insertModel(model);
  return model;
}
