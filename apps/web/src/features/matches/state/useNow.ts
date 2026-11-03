/**
 * The current time, re-read every `intervalMs`, for a clock on screen. The
 * timer stops on unmount.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
