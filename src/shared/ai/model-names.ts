/**
 * Человеческие имена моделей — ЧИСТЫЙ модуль (без server-only): нужен и серверу
 * (каталоги моделей), и клиенту (родословная кандидата). Вынесено из models.ts,
 * который завязан на server-only настройки.
 */

/** Человеческое имя модели: gpt://<каталог>/yandexgpt-5.1/latest → «yandexgpt-5.1»,
 *  openai/gpt-4o-mini → «gpt-4o-mini»; версия ≠ latest — в скобках. Чистая, тестируется. */
export function prettyModelName(id: string): string {
  const uri = /^(?:gpt|emb|art):\/\/[^/]+\/([^/]+)(?:\/([^/@]+))?(?:@(.+))?$/.exec(id)
  if (uri) {
    const [, name, ver, tuned] = uri
    const verPart = ver && ver !== 'latest' ? ` (${ver})` : ''
    return `${name}${tuned ? `@${tuned}` : ''}${verPart}`
  }
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(slash + 1) : id
}

/** Семейство: owned_by провайдера, иначе вендор из префикса id (openai/…, gpt://…/yandexgpt…). */
export function modelFamily(id: string, ownedBy?: string): string {
  if (ownedBy && ownedBy !== 'gateway') return ownedBy
  const slash = id.indexOf('/')
  if (!id.includes('://') && slash > 0) {
    const vendor = id.slice(0, slash)
    return vendor.charAt(0).toUpperCase() + vendor.slice(1)
  }
  const n = prettyModelName(id)
  if (/^(yandexgpt|aliceai)/.test(n)) return 'Yandex'
  if (/^deepseek/.test(n)) return 'DeepSeek'
  if (/^qwen/.test(n)) return 'Qwen'
  if (/^gpt-oss/.test(n)) return 'OpenAI'
  return ''
}
