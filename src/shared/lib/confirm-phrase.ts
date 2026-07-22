// Совпадает ли введённая фраза с ожидаемой (type-to-confirm, как «owner/repo»
// на GitHub перед удалением). Чистая функция — используется и на клиенте
// (гейт кнопки), и на сервере (повторная сверка). Регистронезависимо +
// схлопывание внутренних пробелов: пользователь копирует «handle / slug»
// глазами, лишний пробел не должен блокировать.
export function confirmMatches(typed: string, phrase: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')
  const p = norm(phrase)
  return p.length > 0 && norm(typed) === p
}
