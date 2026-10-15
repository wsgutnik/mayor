/**
 * Opt-in phase timer for the zone pipeline (zone-perf.bench.test.ts). Off by default: every probe is one boolean test,
 * no allocation, so the hot paths pay nothing in the game.
 */
export const zprof = { on: false, ms: new Map<string, number>(), calls: new Map<string, number>() };

/** performance.now() when profiling, else 0 (pass the result to zpEnd). */
export const zpStart = (): number => (zprof.on ? performance.now() : 0);

export function zpEnd(phase: string, t0: number): void {
  if (!zprof.on) return;
  zprof.ms.set(phase, (zprof.ms.get(phase) ?? 0) + performance.now() - t0);
  zprof.calls.set(phase, (zprof.calls.get(phase) ?? 0) + 1);
}

export function zpReset(): void {
  zprof.ms.clear();
  zprof.calls.clear();
}
