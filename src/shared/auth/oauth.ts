// Какие OAuth-провайдеры включены. Провайдер активен, если задан его CLIENT_ID
// и он не перечислен в AUTH_DISABLED_PROVIDERS (скрыть, не удаляя креды: на
// RU-проде — github; на .com GitHub может остаться рабочим).
export type OauthProvider = 'github' | 'yandex' | 'vk'

export function parseDisabledProviders(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function oauthEnabled(): Record<OauthProvider, boolean> {
  const off = parseDisabledProviders(process.env.AUTH_DISABLED_PROVIDERS)
  return {
    github: !!process.env.GITHUB_CLIENT_ID && !off.has('github'),
    yandex: !!process.env.YANDEX_CLIENT_ID && !off.has('yandex'),
    vk: !!process.env.VK_CLIENT_ID && !off.has('vk'),
  }
}
