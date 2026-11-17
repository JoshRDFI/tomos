jest.mock('../lib/llama', () => ({ loadModelInfo: jest.fn() }));
jest.mock('../lib/db', () => ({ insertModel: jest.fn(() => Promise.resolve()) }));

import * as db from '../lib/db';
import * as llama from '../lib/llama';
import { finishModel } from '../lib/modelImport';

const loadModelInfo = llama.loadModelInfo as jest.Mock;
const insertModel = db.insertModel as jest.Mock;
const base = { id: 'm1', fileName: 'Qwen3-8B-Q4_K_M.gguf', filePath: 'file:///x/Qwen3-8B-Q4_K_M.gguf', fileSizeBytes: 5027784512, fileType: null };

beforeEach(() => jest.clearAllMocks());

describe('finishModel', () => {
  it('builds the record from the model file metadata and saves it', async () => {
    loadModelInfo.mockResolvedValue({
      'general.name': 'Qwen3 8B',
      'general.architecture': 'qwen3',
      'qwen3.context_length': 40960,
      'tokenizer.chat_template': 'x',
    });
    const m = await finishModel(base);
    expect(m).toMatchObject({
      id: 'm1',
      displayName: 'Qwen3 8B',
      architecture: 'qwen3',
      trainedContext: 40960,
      detectedTemplate: 'auto-available',
      quantization: 'Q4_K_M',
      templateOverride: 'auto',
      paramsOverride: null,
      filePath: base.filePath,
      fileSizeBytes: 5027784512,
    });
    expect(insertModel).toHaveBeenCalledWith(m);
  });

  it('still saves the model when metadata reading fails', async () => {
    loadModelInfo.mockRejectedValue(new Error('boom'));
    const m = await finishModel(base);
    expect(m).toMatchObject({ displayName: 'Qwen3-8B-Q4_K_M', architecture: null, quantization: 'Q4_K_M' });
    expect(insertModel).toHaveBeenCalledTimes(1);
  });

  it('falls back to the header file type for the quant label', async () => {
    loadModelInfo.mockResolvedValue(null);
    const m = await finishModel({ ...base, fileName: 'model.gguf', fileType: 'Q8_0' });
    expect(m.quantization).toBe('Q8_0');
  });
});
