import { NextResponse, type NextRequest } from 'next/server'
import { isLang, DEFAULT_LANG, t, type Lang } from '@/shared/i18n'

// Режим «сайт на ремонте»: SETFORK_MAINTENANCE=1 в env стенда закрывает всё
// (страницы, API, MCP, git smart-http) честным 503 + Retry-After — браузеры
// показывают заглушку, боты/git-клиенты понимают «времянка, приходи позже»,
// SEO не индексирует ремонт как контент. Выключение — убрать env и рестарт.
// Ассеты /_next пропускаем: они статичны и нужны вкладкам, открытым до ремонта.

const RETRY_AFTER_SEC = '1800' // подсказка клиентам: ~полчаса

function maintenanceHtml(lang: Lang): string {
  const title = t('maintenanceTitle', lang)
  const text = t('maintenanceText', lang)
  // Self-contained: стили инлайном (глобальный CSS недоступен и не нужен),
  // палитра — светлая тема продукта (как в письмах: ink #1c1c1a, muted #6b6b66).
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — SetFork</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#faf9f7;color:#1c1c1a;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<div style="max-width:420px;padding:48px 24px;text-align:center">
<div style="font-size:44px;line-height:1">🔧</div>
<h1 style="margin:16px 0 8px;font-size:20px;font-weight:700">${title}</h1>
<p style="margin:0;font-size:14px;color:#6b6b66">${text}</p>
</div>
</body>
</html>`
}

export function middleware(req: NextRequest) {
  if (process.env.SETFORK_MAINTENANCE !== '1') return NextResponse.next()

  const { pathname } = req.nextUrl
  // Машинные поверхности — короткий text/plain (curl, git, MCP, ридеры фидов).
  const machine =
    pathname.startsWith('/api/') ||
    pathname.endsWith('.bundle') ||
    pathname.endsWith('/raw') ||
    pathname.endsWith('/releases.atom') ||
    /\/(info\/refs|git-upload-pack|git-receive-pack)$/.test(pathname)
  if (machine) {
    return new NextResponse('SetFork is down for maintenance. Retry later.\n', {
      status: 503,
      headers: { 'Retry-After': RETRY_AFTER_SEC, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  const raw = req.cookies.get('lang')?.value ?? ''
  const lang = isLang(raw) ? raw : DEFAULT_LANG
  return new NextResponse(maintenanceHtml(lang), {
    status: 503,
    headers: { 'Retry-After': RETRY_AFTER_SEC, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export const config = {
  // Всё, кроме ассетов сборки и статики корня (иконки/манифест).
  matcher: ['/((?!_next/|favicon\\.ico|icon\\.|apple-icon|manifest\\.).*)'],
}
