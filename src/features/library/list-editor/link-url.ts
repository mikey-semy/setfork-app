/** Домен вместо полного адреса: смотреть на «https://…» незачем, а места он
 *  занимает много. Полный адрес живёт в подсказке чипа.
 *
 *  Функция лежит отдельно от компонентов: файл с компонентом должен экспортировать
 *  только компоненты, иначе Fast Refresh перезагружает страницу целиком. */
export function linkHost(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).host
  } catch {
    return s
  }
}
