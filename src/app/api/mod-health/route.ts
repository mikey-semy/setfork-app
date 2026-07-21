import { getModerationCounts } from '@/features/moderation/queries'

/**
 * Маячок очереди модерации для внешнего мониторинга (HQ §9, фидбек владельца
 * «модерация без оповещений в Telegram»). api.telegram.org с RU-сервера
 * недоступен (ТСПУ) — путь оповещений: UptimeRobot опрашивает этот эндпоинт
 * keyword-монитором (слово MOD_PENDING) и сам шлёт в Telegram, как уже
 * работает для PROBLEM/healthz. Наружу — только числа, никакого контента.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const c = await getModerationCounts()
    const n = c.pending + c.flagged
    return new Response(n > 0 ? `MOD_PENDING ${n} (pending ${c.pending}, flagged ${c.flagged})\n` : 'MOD_OK\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch {
    return new Response('MOD_ERROR\n', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
}
