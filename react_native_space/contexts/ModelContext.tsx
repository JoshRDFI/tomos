import React, { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { ModelRecord, ModelStatus } from '@/types';
import type { ParamSet } from '@/lib/params';
import * as llama from '@/lib/llama';
import * as db from '@/lib/db';

interface ModelCtx {
  loadedModelId: string | null;
  loadedModel: ModelRecord | null;
  status: ModelStatus;
  error: string | null;
  errorDetails: string | null;
  isGenerating: boolean;
  /** Resolves true if the model is loaded and ready afterwards. */
  loadModel: (model: ModelRecord, loadParams: ParamSet) => Promise<boolean>;
  unload: () => Promise<void>;
  /** Re-read the loaded model's record, after it was renamed or edited elsewhere. */
  refreshLoadedModel: () => Promise<void>;
  setGenerating: (v: boolean) => void;
}

const Ctx = createContext<ModelCtx>({
  loadedModelId: null,
  loadedModel: null,
  status: 'idle',
  error: null,
  errorDetails: null,
  isGenerating: false,
  loadModel: async () => false,
  unload: async () => {},
  refreshLoadedModel: async () => {},
  setGenerating: () => {},
});

export function ModelProvider({ children }: { children: ReactNode }) {
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [loadedModel, setLoadedModel] = useState<ModelRecord | null>(null);
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isGenerating, setGenerating] = useState(false);
  // Serialize loads: a second request waits for the first to finish and then
  // runs, instead of silently returning while the first is still loading.
  const loadChain = useRef<Promise<unknown>>(Promise.resolve());

  const loadOnce = useCallback(async (model: ModelRecord, loadParams: ParamSet): Promise<boolean> => {
    setStatus('loading');
    setError(null);
    setErrorDetails(null);

    // Memory check (before releasing whatever is currently loaded)
    try {
      const Device = await import('expo-device');
      const totalMem = (Device as any)?.totalMemory ?? 0;
      if (totalMem > 0 && model.fileSizeBytes > 0.6 * totalMem) {
        const sizeGB = (model.fileSizeBytes / (1024 * 1024 * 1024)).toFixed(1);
        setError(`This model (${sizeGB} GB) is likely too large for this phone's memory. Try a smaller quantization like Q4_K_M or a model of 8B parameters or fewer.`);
        // Previous model (if any) is still loaded and usable.
        setStatus(llama.getLoadedModelId() ? 'ready' : 'error');
        return false;
      }
    } catch {}

    try {
      await llama.loadModel(model, loadParams);
      setLoadedModelId(model.id);
      setLoadedModel(model);
      setStatus('ready');
      db.setSetting('lastModelId', model.id).catch(() => {});
      return true;
    } catch (e: any) {
      // llama.loadModel released the previous context before failing, so
      // nothing is loaded any more.
      setLoadedModelId(null);
      setLoadedModel(null);
      setError("Couldn't load this file. It may not be a valid GGUF model or may be corrupted.");
      setErrorDetails(e?.message ?? String(e));
      setStatus('error');
      return false;
    }
  }, []);

  const doLoad = useCallback((model: ModelRecord, loadParams: ParamSet): Promise<boolean> => {
    if (Platform.OS === 'web') return Promise.resolve(false);
    const next = loadChain.current.catch(() => {}).then(() => loadOnce(model, loadParams));
    loadChain.current = next;
    return next;
  }, [loadOnce]);

  const unload = useCallback(async () => {
    await llama.releaseModel();
    setLoadedModelId(null);
    setLoadedModel(null);
    setStatus('idle');
    setError(null);
    setErrorDetails(null);
  }, []);

  const loadedIdRef = useRef<string | null>(null);
  loadedIdRef.current = loadedModelId;
  const refreshLoadedModel = useCallback(async () => {
    const id = loadedIdRef.current;
    if (!id) return;
    const fresh = await db.getModel(id);
    // Skip if a different model was loaded while reading.
    if (fresh && loadedIdRef.current === id) setLoadedModel(fresh);
  }, []);

  return (
    <Ctx.Provider value={{ loadedModelId, loadedModel, status, error, errorDetails, isGenerating, loadModel: doLoad, unload, refreshLoadedModel, setGenerating }}>
      {children}
    </Ctx.Provider>
  );
}

export function useModelContext() {
  return useContext(Ctx);
}
