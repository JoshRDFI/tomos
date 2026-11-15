import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { ThemeMode } from '@/types';
import * as db from '@/lib/db';

interface SettingsState {
  themeMode: ThemeMode;
  defaultSystemPrompt: string;
  ready: boolean;
}

interface SettingsActions {
  setThemeMode: (m: ThemeMode) => void;
  setDefaultSystemPrompt: (s: string) => void;
}

type SettingsCtx = SettingsState & SettingsActions;

const Ctx = createContext<SettingsCtx>({
  themeMode: 'dark',
  defaultSystemPrompt: 'You are a helpful, concise assistant.',
  ready: false,
  setThemeMode: () => {},
  setDefaultSystemPrompt: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [themeMode, _setThemeMode] = useState<ThemeMode>('dark');
  const [defaultSystemPrompt, _setDefaultSystemPrompt] = useState('You are a helpful, concise assistant.');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') { setReady(true); return; }
    (async () => {
      try {
        await db.getDb();
        const tm = await db.getSetting('themeMode');
        if (tm === 'light' || tm === 'system') _setThemeMode(tm);
        const sp = await db.getSetting('defaultSystemPrompt');
        if (sp != null) _setDefaultSystemPrompt(sp);
      } catch (e) {
        console.warn('Settings init error', e);
      }
      setReady(true);
    })();
  }, []);

  const setThemeMode = useCallback((m: ThemeMode) => {
    _setThemeMode(m);
    db.setSetting('themeMode', m).catch(() => {});
  }, []);

  const setDefaultSystemPrompt = useCallback((s: string) => {
    _setDefaultSystemPrompt(s);
    db.setSetting('defaultSystemPrompt', s).catch(() => {});
  }, []);


  return (
    <Ctx.Provider value={{ themeMode, defaultSystemPrompt, ready, setThemeMode, setDefaultSystemPrompt }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettings() {
  return useContext(Ctx);
}
