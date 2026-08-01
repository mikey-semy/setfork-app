/**
 * ПРИЧИНА человеческим языком. `fetch failed` в баннере — это не сообщение, а строка из
 * недр node: владелец видел её и спрашивал «ключ есть или нет?», хотя ключ ни при чём.
 * Различаем три случая, потому что чинятся они в трёх разных местах:
 *  - нет ключа              → ввести ключ здесь;
 *  - HTTP-код от провайдера → ключ/права/лимит на его стороне;
 *  - соединение не встало   → СЕТЬ сервера (у нас это egress-мост до openrouter.ai),
 *                             ни ключ, ни модель, ни код тут ни при чём.
 */
export function catalogProblem(error: string, say: (en: string, rus: string) => string): string {
  if (error === 'no-key') {
    return say('No key for this provider — enter it above.', 'У этого провайдера нет ключа — введите его выше.')
  }
  if (/^HTTP \d/.test(error)) {
    return say(
      `The provider answered ${error} — the key, its permissions or a limit on the provider side. The model id can still be typed by hand.`,
      `Провайдер ответил ${error} — дело в ключе, его правах или лимите на стороне провайдера. Id модели можно ввести вручную.`,
    )
  }
  return say(
    `The server could not connect to the provider (${error}). This is the server network, not the key and not the model. Meanwhile: switch to another provider or type the model id by hand.`,
    `Сервер не смог соединиться с провайдером (${error}). Это сеть сервера, а не ключ и не модель. Пока: переключись на другого провайдера или введи id модели вручную.`,
  )
}

