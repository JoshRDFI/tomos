import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { ThemeMode } from '@/types';
import * as db from '@/lib/db';

interface SettingsState {
  themeMode: ThemeMode;
  defaultSystemPrompt: string;
  /** Add today's date to the system prompt. */
  includeDate: boolean;
  ready: boolean;
}

interface SettingsActions {
  setThemeMode: (m: ThemeMode) => void;
  setDefaultSystemPrompt: (s: string) => void;
  setIncludeDate: (on: boolean) => void;
  /** Re-read everything from the database (after restoring a backup). */
  reload: () => Promise<void>;
}

type SettingsCtx = SettingsState & SettingsActions;

const Ctx = createContext<SettingsCtx>({
  themeMode: 'dark',
  defaultSystemPrompt: 'You are a helpful, concise assistant.',
  includeDate: true,
  ready: false,
  setThemeMode: () => {},
  setDefaultSystemPrompt: () => {},
  setIncludeDate: () => {},
  reload: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [themeMode, _setThemeMode] = useState<ThemeMode>('dark');
  const [defaultSystemPrompt, _setDefaultSystemPrompt] = useState('You are a helpful, concise assistant.');
  const [includeDate, _setIncludeDate] = useState(true);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      await db.getDb();
      const tm = await db.getSetting('themeMode');
      _setThemeMode(tm === 'light' || tm === 'system' ? tm : 'dark');
      const sp = await db.getSetting('defaultSystemPrompt');
      _setDefaultSystemPrompt(sp ?? 'You are a helpful, concise assistant.');
      _setIncludeDate((await db.getSetting('includeDate')) !== '0');
    } catch (e) {
      console.warn('Settings init error', e);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') { setReady(true); return; }
    reload().finally(() => setReady(true));
  }, [reload]);

  const setThemeMode = useCallback((m: ThemeMode) => {
    _setThemeMode(m);
    db.setSetting('themeMode', m).catch(() => {});
  }, []);

  const setDefaultSystemPrompt = useCallback((s: string) => {
    _setDefaultSystemPrompt(s);
    db.setSetting('defaultSystemPrompt', s).catch(() => {});
  }, []);


  const setIncludeDate = useCallback((on: boolean) => {
    _setIncludeDate(on);
    db.setSetting('includeDate', on ? '1' : '0').catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ themeMode, defaultSystemPrompt, includeDate, ready, setThemeMode, setDefaultSystemPrompt, setIncludeDate, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettings() {
  return useContext(Ctx);
}
