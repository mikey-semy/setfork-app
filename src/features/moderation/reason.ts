import type { Lang } from '@/shared/i18n'

/**
 * Машинная причина модерации (в БД — английская диагностика для очереди админа) →
 * человеческая фраза для баннера владельцу. Формы порождают automation.ts и
 * moderate-list.ts — маппинг по известным префиксам. Незнакомый текст возвращаем
 * как есть: это либо причина, написанная админом руками (уже человеческая),
 * либо новый машинный формат — сырая правда лучше спрятанной.
 */
export function humanModerationReason(reason: string, lang: Lang): string {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  if (/^AI uncertain/i.test(reason))
    return say('the automatic check was not sure — a moderator will take a look', 'автопроверка не уверена — посмотрит модератор')
  if (/^AI budget exhausted/i.test(reason)) return say('awaiting manual review', 'ждёт ручной проверки модератором')
  if (/^Re-upload/i.test(reason)) return say('matches previously removed content', 'совпадает с ранее удалённым контентом')
  if (/^spam heuristic: empty list/i.test(reason)) return say('the list has no items', 'в списке нет пунктов')
  if (/^spam heuristic: no meaningful title/i.test(reason)) return say('the title is missing or too short', 'нет осмысленного названия')
  if (/^spam heuristic: url shortener/i.test(reason))
    return say('links via URL shorteners are not allowed', 'ссылки через сокращатели запрещены')
  if (/^spam heuristic: link farm/i.test(reason))
    return say('too many links to different sites', 'слишком много ссылок на разные сайты')
  const ai = reason.match(/^AI \[(.+?)\]/)
  if (ai) return say(`the automatic check found a possible violation (${ai[1]})`, `автопроверка увидела возможное нарушение (${ai[1]})`)
  return reason
}
