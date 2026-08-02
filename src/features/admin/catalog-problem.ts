import { t, type Lang } from '@/shared/i18n'

/**
 * ПРИЧИНА человеческим языком. `fetch failed` в баннере — это не сообщение, а строка из
 * недр node: владелец видел её и спрашивал «ключ есть или нет?», хотя ключ ни при чём.
 * Различаем три случая, потому что чинятся они в трёх разных местах:
 *  - нет ключа              → ввести ключ здесь;
 *  - HTTP-код от провайдера → ключ/права/лимит на его стороне;
 *  - соединение не встало   → СЕТЬ сервера (у нас это egress-мост до openrouter.ai),
 *                             ни ключ, ни модель, ни код тут ни при чём.
 */
export function catalogProblem(error: string, lang: Lang): string {
  if (error === 'no-key') return t('admin.problemNoKey', lang)
  if (/^HTTP \d/.test(error)) return t('admin.problemHttp', lang).replace('{e}', error)
  return t('admin.problemNetwork', lang).replace('{e}', error)
}
