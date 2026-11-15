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
  loadModel: (model: ModelRecord, ctxParams: { contextLength: number; threads: number }) => Promise<void>;
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
  loadModel: async () => {},
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
  const loadingRef = useRef(false);

  const doLoad = useCallback(async (model: ModelRecord, ctxParams: { contextLength: number; threads: number }) => {
    if (Platform.OS === 'web') return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setStatus('loading');
    setError(null);
    setErrorDetails(null);

    try {
      // Memory check
      try {
        const Device = await import('expo-device');
        const totalMem = (Device as any)?.totalMemory ?? 0;
        if (totalMem > 0 && model.fileSizeBytes > 0.6 * totalMem) {
          const sizeGB = (model.fileSizeBytes / (1024 * 1024 * 1024)).toFixed(1);
          setError(`This model (${sizeGB} GB) is likely too large for this phone's memory. Try a smaller quantization like Q4_K_M or a model of 8B parameters or fewer.`);
          setStatus('error');
          loadingRef.current = false;
          return;
        }
      } catch {}

      await llama.loadModel(model, ctxParams);
      setLoadedModelId(model.id);
      setLoadedModel(model);
      setLoadedCtxParams({ ...ctxParams });
      setStatus('ready');
      db.setSetting('lastModelId', model.id).catch(() => {});
    } catch (e: any) {
      setError("Couldn't load this file. It may not be a valid GGUF model or may be corrupted.");
      setErrorDetails(e?.message ?? String(e));
      setStatus('error');
    }
    loadingRef.current = false;
  }, []);

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
