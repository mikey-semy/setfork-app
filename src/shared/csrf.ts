// CSRF-защита для cookie-авторизованных route handlers (у Server Actions она встроена,
// у route handlers — нет). Пускаем только same-origin/same-site запросы.
// Основной сигнал — заголовок Sec-Fetch-Site (есть во всех современных браузерах, не
// подделывается из JS); фолбэк — сверка host из Origin с Host.

export function sameOrigin(h: { secFetchSite?: string | null; origin?: string | null; host?: string | null }): boolean {
  const site = h.secFetchSite
  if (site) return site === 'same-origin' || site === 'same-site' || site === 'none'
  // Нет Sec-Fetch-Site (старый браузер / не браузер): если есть Origin — сверяем host.
  if (!h.origin) return true // curl/навигация без Origin — не CSRF-вектор из браузера
  try {
    return new URL(h.origin).host === h.host
  } catch {
    return false
  }
}

export function isSameOriginRequest(req: Request): boolean {
  return sameOrigin({
    secFetchSite: req.headers.get('sec-fetch-site'),
    origin: req.headers.get('origin'),
    host: req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
  })
}

/** 403-ответ для кросс-origin мутаций (или null, если запрос свой). */
export function crossOriginBlock(req: Request): Response | null {
  return isSameOriginRequest(req) ? null : new Response('Cross-origin request blocked', { status: 403 })
}
