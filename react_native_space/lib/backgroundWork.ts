// Keeps a reply or summary running with the screen off. Android freezes a
// backgrounded app unless it runs a foreground service, so the service is on
// while any generation is; modules/generation-service is the native side.
import { Platform } from 'react-native';
import { splitThinking } from './thinking';

export interface BackgroundNative {
  /** Start the service or update its notification. False when Android refused (e.g. started from the background). */
  start(o: { title: string; text: string }): boolean;
  stop(): void;
  notifyDone(o: { title: string; body: string; subtitle: string | null; sessionId: string }): void;
}

export type WorkKind = 'reply' | 'summary';

const TEXT: Record<WorkKind, string> = {
  reply: 'Generating reply…',
  summary: 'Condensing earlier messages…',
};

/**
 * `begin()` turns the service on and returns the matching `end()`. The service
 * stops `stopDelayMs` after the last work ends, so a summary that starts right
 * after a reply keeps it running: Android won't let a backgrounded app start
 * it again. Native failures are logged, never thrown: without the service,
 * generation still works in the foreground.
 */
export function createBackgroundWork(getNative: () => BackgroundNative | null, opts: { stopDelayMs: number }) {
  let active = 0;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  const call = (what: string, f: (n: BackgroundNative) => void) => {
    try {
      const n = getNative();
      if (n) f(n);
    } catch (e) {
      console.warn(`[bg] ${what} failed`, e);
    }
  };

  return {
    begin(kind: WorkKind): () => void {
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      active++;
      call('start', (n) => { if (!n.start({ title: 'Tomos', text: TEXT[kind] })) console.warn('[bg] service not started'); });
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        active--;
        if (active > 0) return;
        stopTimer = setTimeout(() => {
          stopTimer = null;
          if (active === 0) call('stop', (n) => n.stop());
        }, opts.stopDelayMs);
      };
    },
    notifyDone(o: { title: string; body: string; subtitle?: string | null; sessionId: string }) {
      call('notify', (n) => n.notifyDone({ ...o, subtitle: o.subtitle ?? null }));
    },
  };
}

const MAX_BODY = 120;

/** The "Reply ready" notification: the answer's first line, plain text. */
export function replyReadyNotice(content: string, chatTitle: string | null): { title: string; body: string; subtitle: string | null } {
  const answer = splitThinking(content).answer;
  const line = (answer.split('\n').map((l) => l.replace(/[*_`#>]+/g, '').trim()).find(Boolean) ?? '');
  const body = !line ? 'Tap to read it.' : line.length > MAX_BODY ? line.slice(0, MAX_BODY - 1) + '…' : line;
  return { title: 'Reply ready', body, subtitle: chatTitle };
}

function nativeModule(): BackgroundNative | null {
  if (Platform.OS !== 'android') return null;
  // Loaded lazily so tests and other platforms never touch the native module.
  return require('../modules/generation-service').default as BackgroundNative;
}

export const backgroundWork = createBackgroundWork(nativeModule, { stopDelayMs: 5000 });

/** The ongoing notification's Stop button. Returns the unsubscribe. */
export function onStopRequest(listener: () => void): () => void {
  try {
    const n = nativeModule() as (BackgroundNative & { addListener?: (e: 'onStopRequest', l: () => void) => { remove(): void } }) | null;
    const sub = n?.addListener?.('onStopRequest', listener);
    return () => sub?.remove();
  } catch (e) {
    console.warn('[bg] listener failed', e);
    return () => {};
  }
}
