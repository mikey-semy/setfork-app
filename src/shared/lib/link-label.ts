// Подпись ссылки, когда её не написали. Требовать label у каждой ссылки — лишний
// повод ошибиться (жалоба владельца 04.08.2026: первый вызов API упал на
// `refs[0].label — Required`). Разумная форма — одна строка {"url": "..."},
// а подпись интерфейс выводит сам: домен читается и говорит, куда ведёт ссылка.

/** URL без протокола и хвостового слэша — для показа ссылки текстом. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/** Хост ссылки без www; если это не разбираемый URL — вернёт пустое. */
export function linkHost(url: string | undefined): string {
  if (!url) return ''
  const raw = url.trim()
  if (!raw) return ''
  try {
    // Относительные и схемо-less ссылки тоже должны давать хост.
    const u = new URL(/^[a-z][\w+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return u.hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** Что показать на ссылке: подпись автора, иначе домен, иначе сам адрес. */
export function linkLabel(label: string | undefined, url: string | undefined): string {
  const written = (label ?? '').trim()
  if (written) return written
  return linkHost(url) || displayUrl((url ?? '').trim())
}
