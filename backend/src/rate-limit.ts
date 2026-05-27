type RateState = {
  count: number;
  windowStartMs: number;
};

const state = new Map<string, RateState>();
const WINDOW_MS = 60 * 60 * 1000;

export function consumeRateLimit(
  key: string,
  maxPerHour: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const current = state.get(key);

  if (!current || now - current.windowStartMs >= WINDOW_MS) {
    state.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: maxPerHour - 1 };
  }

  if (current.count >= maxPerHour) {
    return { allowed: false, remaining: 0 };
  }

  current.count += 1;
  state.set(key, current);

  return { allowed: true, remaining: maxPerHour - current.count };
}
