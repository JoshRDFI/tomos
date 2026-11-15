/**
 * Throttle streamed markdown by how long it takes to render.
 *
 * Adapted from DeepSeek's chat demo (src/components/markdown/useThrottleMarkdownRender.ts,
 * MIT, Copyright (c) 2026 DeepSeek; full notice in lib/markdown.ts).
 *
 * After each update, the next one waits RATE × (time the last one took to
 * commit), capped at MAX_WAIT. Tokens arriving in between are merged, so a
 * long reply that's slow to lay out updates less often instead of falling
 * behind. When `enable` is false the latest text is returned directly.
 */
import { useEffect, useRef, useState } from 'react';

const MAX_WAIT = 1000;
const RATE = 2;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function useThrottledText(content: string, enable: boolean): string {
  const startRef = useRef(now());
  const updatableAtRef = useRef(0);
  const [output, setOutput] = useState(content);

  // Runs after the update committed: schedule the earliest next update.
  useEffect(() => {
    const t = now();
    updatableAtRef.current = t + Math.min(MAX_WAIT, (t - startRef.current) * RATE);
  }, [output]);

  useEffect(() => {
    if (!enable) return;
    const update = () => {
      startRef.current = now();
      setOutput(content);
    };
    const delay = updatableAtRef.current - now();
    if (delay <= 0) {
      update();
      return;
    }
    const timer = setTimeout(update, delay);
    return () => clearTimeout(timer);
  }, [content, enable]);

  return enable ? output : content;
}
