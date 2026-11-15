import React, { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { ModelRecord, ModelStatus, GenParams } from '@/types';
import * as llama from '@/lib/llama';
import * as db from '@/lib/db';

interface ModelCtx {
  loadedModelId: string | null;
  loadedModel: ModelRecord | null;
  loadedCtxParams: { contextLength: number; threads: number } | null;
  status: ModelStatus;
  error: string | null;
  errorDetails: string | null;
  isGenerating: boolean;
  /** Resolves true if the model is loaded and ready afterwards. */
  loadModel: (model: ModelRecord, ctxParams: { contextLength: number; threads: number }) => Promise<boolean>;
  unload: () => Promise<void>;
  setGenerating: (v: boolean) => void;
}

const Ctx = createContext<ModelCtx>({
  loadedModelId: null,
  loadedModel: null,
  loadedCtxParams: null,
  status: 'idle',
  error: null,
  errorDetails: null,
  isGenerating: false,
  loadModel: async () => false,
  unload: async () => {},
  setGenerating: () => {},
});

export function ModelProvider({ children }: { children: ReactNode }) {
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [loadedModel, setLoadedModel] = useState<ModelRecord | null>(null);
  const [loadedCtxParams, setLoadedCtxParams] = useState<{ contextLength: number; threads: number } | null>(null);
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isGenerating, setGenerating] = useState(false);
  // Serialize loads: a second request waits for the first to finish and then
  // runs, instead of silently returning while the first is still loading.
  const loadChain = useRef<Promise<unknown>>(Promise.resolve());

  const loadOnce = useCallback(async (model: ModelRecord, ctxParams: { contextLength: number; threads: number }): Promise<boolean> => {
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
      await llama.loadModel(model, ctxParams);
      setLoadedModelId(model.id);
      setLoadedModel(model);
      setLoadedCtxParams({ ...ctxParams });
      setStatus('ready');
      db.setSetting('lastModelId', model.id).catch(() => {});
      return true;
    } catch (e: any) {
      // llama.loadModel released the previous context before failing, so
      // nothing is loaded any more.
      setLoadedModelId(null);
      setLoadedModel(null);
      setLoadedCtxParams(null);
      setError("Couldn't load this file. It may not be a valid GGUF model or may be corrupted.");
      setErrorDetails(e?.message ?? String(e));
      setStatus('error');
      return false;
    }
  }, []);

  const doLoad = useCallback((model: ModelRecord, ctxParams: { contextLength: number; threads: number }): Promise<boolean> => {
    if (Platform.OS === 'web') return Promise.resolve(false);
    const next = loadChain.current.catch(() => {}).then(() => loadOnce(model, ctxParams));
    loadChain.current = next;
    return next;
  }, [loadOnce]);

  const unload = useCallback(async () => {
    await llama.releaseModel();
    setLoadedModelId(null);
    setLoadedModel(null);
    setLoadedCtxParams(null);
    setStatus('idle');
    setError(null);
    setErrorDetails(null);
  }, []);

  return (
    <Ctx.Provider value={{ loadedModelId, loadedModel, loadedCtxParams, status, error, errorDetails, isGenerating, loadModel: doLoad, unload, setGenerating }}>
      {children}
    </Ctx.Provider>
  );
}

export function useModelContext() {
  return useContext(Ctx);
}
