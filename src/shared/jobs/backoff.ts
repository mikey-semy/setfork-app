/** Экспоненциальный backoff между ретраями задачи: 2^attempts секунд, кап 5 минут. */
export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 1000 * 2 ** Math.max(0, attempts))
}
