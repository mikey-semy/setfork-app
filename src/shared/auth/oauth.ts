// Какие OAuth-провайдеры включены. Провайдер активен, если задан его CLIENT_ID
// и он не перечислен в AUTH_DISABLED_PROVIDERS (скрыть, не удаляя креды: на
// RU-проде — github; на .com GitHub может остаться рабочим).
export type OauthProvider = "github" | "yandex" | "vk" | "telegram";

export function parseDisabledProviders(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function oauthEnabled(): Record<OauthProvider, boolean> {
  const off = parseDisabledProviders(process.env.AUTH_DISABLED_PROVIDERS);
  return {
    github: !!process.env.GITHUB_CLIENT_ID && !off.has("github"),
    yandex: !!process.env.YANDEX_CLIENT_ID && !off.has("yandex"),
    vk: !!process.env.VK_CLIENT_ID && !off.has("vk"),
    // Telegram — вход через бота (см. shared/telegram), не классический OAuth.
    telegram:
      !!process.env.TELEGRAM_BOT_TOKEN &&
      !!process.env.TELEGRAM_BOT_USERNAME &&
      !off.has("telegram"),
  };
}

/**
 * Разрешён ли demo-вход (общий публичный аккаунт, dev-фолбэк).
 * Выключается тем же списком: AUTH_DISABLED_PROVIDERS=...,demo — на проде,
 * где контент создаётся под реальными учётками, публичный demo не нужен:
 * посмотреть каталог и поиск можно и без входа (explore открыт анонимно).
 * Проверять ОБЯЗАТЕЛЬНО и в UI, и в самом роуте — иначе прямой POST на
 * /api/auth/demo обходит спрятанную кнопку.
 */
export function demoLoginEnabled(): boolean {
  return !parseDisabledProviders(process.env.AUTH_DISABLED_PROVIDERS).has(
    "demo",
  );
}
