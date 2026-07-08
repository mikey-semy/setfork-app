// Единый HTML/XML/SVG-эскейпер. Раньше было 5 разошедшихся копий `esc()`: одна
// экранировала апостроф, четыре — нет, и значение в атрибуте в ОДИНАРНЫХ кавычках
// пробивало 4 из 5 (attribute-breakout). Один набор символов, один тест, один импорт.
// Покрывает и HTML-текст, и значения атрибутов (обе кавычки), и XML (Atom-фид).
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c])
}

// XML — тот же безопасный набор символов.
export const escapeXml = escapeHtml
