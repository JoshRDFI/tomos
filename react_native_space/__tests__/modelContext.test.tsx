import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { ModelProvider, useModelContext } from '../contexts/ModelContext';
import type { ModelRecord } from '../types';

const stored: Record<string, ModelRecord> = {};
jest.mock('../lib/llama', () => ({ loadModel: jest.fn(async () => {}), releaseModel: jest.fn(async () => {}), getLoadedModelId: () => null }));
jest.mock('../lib/db', () => ({ getModel: jest.fn(async (id: string) => stored[id] ?? null), setSetting: jest.fn(async () => {}) }));
jest.mock('expo-device', () => ({ totalMemory: 0 }));

const model = { id: 'm1', displayName: 'Huihui-Qwen3.5-9B', fileName: 'h.gguf', fileSizeBytes: 1 } as ModelRecord;

describe('ModelContext', () => {
  it('picks up a rename of the loaded model', async () => {
    const { result } = renderHook(() => useModelContext(), { wrapper: ModelProvider });
    await act(async () => { await result.current.loadModel(model, {}); });
    stored.m1 = { ...model, displayName: 'Chat' };
    await act(async () => { await result.current.refreshLoadedModel(); });
    expect(result.current.loadedModel?.displayName).toBe('Chat');
  });

  it('a refresh with nothing loaded keeps nothing loaded', async () => {
    const { result } = renderHook(() => useModelContext(), { wrapper: ModelProvider });
    await act(async () => { await result.current.refreshLoadedModel(); });
    expect(result.current.loadedModel).toBeNull();
  });
});
