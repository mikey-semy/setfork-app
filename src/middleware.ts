import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { isLang, DEFAULT_LANG, t, type Lang } from '@/shared/i18n'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { maintenanceEnabled } from '@/shared/settings/maintenance'
import { REQUEST_PATH_HEADER } from '@/shared/request-path'
import { dialectMime, errorScript, normalizeDialect } from '@/core/domain/script-dialect'

// Режим «сайт на ремонте»: включается админом из /admin (флаг в БД, кэш 5с)
// либо аварийно env SETFORK_MAINTENANCE=1. Всё отвечает 503 + Retry-After,
// КРОМЕ: ассетов /_next, страницы входа (/login и /api/auth/* — админ должен
// смочь войти) и залогиненных админов — они ходят по сайту свободно и
// выключают режим в /admin. Node-runtime: нужен доступ к БД для флага.

const RETRY_AFTER_SEC = '1800' // подсказка клиентам: ~полчаса
/** Текст ремонта для машин — один на все машинные поверхности (английский: их читают не люди). */
const MAINTENANCE_LINE = 'SetFork is down for maintenance. Retry later.'

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

/** Залогинен ли админ: верифицируем session-JWT (HS256, AUTH_SECRET) и сверяем
 *  handle с ADMIN_HANDLES. Без похода в реестр sessions — для байпаса ремонта
 *  достаточно валидной подписи (отзыв сессии тут не критичен). */
async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('setfork_session')?.value
  if (!token) return false
  const secret = process.env.AUTH_SECRET
  if (!secret) return false
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    return isAdminHandle(typeof payload.handle === 'string' ? payload.handle : null)
  } catch {
    return false
  }
}

/**
 * Пропустить запрос дальше, сообщив серверным компонентам ПУТЬ.
 *
 * В App Router путь текущего запроса компоненту недоступен, а он нужен ровно одному
 * потребителю — перенаправлению с прежнего адреса списка (shared/db/moved-list):
 * без пути ссылка на `/owner/старый-слаг/issues` привела бы на корень списка, а с
 * ним сохраняется вкладка, как это делает Gitea (там заменяют сегмент owner/name и
 * оставляют весь остаток пути с query).
 */
function pass(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers)
  // Путь ВМЕСТЕ с query: перенаправление обязано сохранить и то и другое.
  headers.set(REQUEST_PATH_HEADER, req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.next({ request: { headers } })
}

/**
 * Прежние адреса раздела «открытие» → их нынешние страницы.
 *
 * Вкладки жили параметрами одной страницы (`/explore?tab=trending&view=people`), а
 * теперь у каждой свой адрес. Разосланные ссылки обязаны продолжать работать.
 *
 * Перенаправление живёт ЗДЕСЬ, а не в самой странице, по обязательной причине: у
 * `/explore` есть loading.tsx, то есть потоковая отдача — заголовки уходят клиенту ДО
 * рендера, и `redirect()` из компонента уже не может сменить статус (проверено:
 * ответ оставался 200 со старой страницей). Тем же образом когда-то «не найдено»
 * уезжало с кодом 200. Маршрутизации здесь и место: ни базы, ни сессии не нужно.
 */
function legacyExploreTarget(url: NextRequest['nextUrl']): string | null {
  if (url.pathname !== '/explore') return null
  const tab = url.searchParams.get('tab')
  if (tab === 'topics') return '/tags'
  if (tab === 'collections') return '/collections'
  if (tab !== 'trending') return null
  if (url.searchParams.get('view') === 'people') return '/trending/people'
  const range = url.searchParams.get('range')
  // Неделя — состояние по умолчанию, её в адресе не оставляем.
  return range && range !== 'week' ? `/trending?range=${range}` : '/trending'
}

/**
 * `/{handle}/{slug}.md` — тот же список в markdown.
 *
 * Адрес с суффиксом читается человеком и агентом одинаково: «дай мне это файлом».
 * Переписыванием, а не своим роутом, — потому что рендерер обязан остаться ОДИН:
 * второй вариант markdown разошёлся бы с экспортом, и агент, прочитавший список по
 * суффиксу, получил бы не то, что скачал бы по кнопке.
 *
 * Только два сегмента: `/a/b.md` — список, а `/a/b/c.md` уже не он. Точка в слаге
 * невозможна (слаг строится транслитерацией), поэтому `.md` в конце однозначен.
 */
function markdownSuffixTarget(url: URL): string | null {
  const m = /^\/([^/]+)\/([^/]+)\.md$/.exec(url.pathname)
  if (!m) return null
  const [, handle, slug] = m
  return `/${handle}/${slug}/export?format=md`
}

export async function middleware(req: NextRequest) {
  const legacy = legacyExploreTarget(req.nextUrl)
  if (legacy) return NextResponse.redirect(new URL(legacy, req.url), 308)

  // ПРОБЫ ПРОПУСКАЕМ ДО обращения к БД. `maintenanceEnabled()` ходит в ту же
  // базу и своего потолка ожидания не имеет: при исчерпанном пуле или зависшем
  // (а не отказавшем) соединении запрос ждёт до таймаута получения клиента —
  // и проба готовности, чей смысл в быстром ответе, зависла бы, не дойдя до
  // хендлера. Проверка пути дешевле запроса, поэтому она и идёт первой.
  //
  // /api/health — liveness Docker-контейнера: ДОЛЖНА отдавать 200 даже в
  // ремонте, иначе healthcheck валит контейнер (unhealthy → Traefik выкидывает
  // из роутинга → 404 на весь сайт, и заглушка «ремонт» даже не показывается).
  // /api/ready — readiness для внешнего монитора: она обязана отвечать САМА,
  // в том числе когда база мертва (в этом её работа), и в ремонте тоже.
  const { pathname } = req.nextUrl
  if (pathname === '/api/health' || pathname === '/api/ready') return pass(req)

  if (!(await maintenanceEnabled())) {
    // ⚠️ `.md` ПОСЛЕ проверки режима, а не до неё. Стоя выше, переписывание отдавало
    // 200 с полным содержимым и продолжало ходить в базу ровно тогда, когда режим
    // обслуживания существует, чтобы база молчала. Машинная поверхность — не повод
    // обходить ремонт: `/raw` и `/api/` его не обходят.
    const md = markdownSuffixTarget(req.nextUrl)
    return md ? NextResponse.rewrite(new URL(md, req.url)) : pass(req)
  }
  // Дверь для админа: страница входа и auth-эндпоинты (GitHub OAuth, POST
  // server actions самого /login) остаются открыты.
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) return pass(req)

  if (await isAdminRequest(req)) return pass(req)

  // Машинные поверхности — короткий text/plain (curl, git, MCP, ридеры фидов).
  const machine =
    pathname.startsWith('/api/') ||
    pathname.endsWith('.bundle') ||
    // `.md` — тоже машинная поверхность: этот адрес мы САМИ рекламируем агентам в
    // llms.txt («допишите .md к адресу»). Человеческая заглушка ремонта им не нужна.
    pathname.endsWith('.md') ||
    pathname.endsWith('/raw') ||
    pathname.endsWith('/releases.atom') ||
    /\/(info\/refs|git-upload-pack|git-receive-pack)$/.test(pathname)
  if (machine) {
    // `/raw` отдаёт ИСПОЛНЯЕМЫЙ КОД, и его тело уходит прямо в интерпретатор. Обычная
    // строка «SetFork is down for maintenance» там — не сообщение, а команда: шелл
    // отвечает на неё `SetFork: command not found`. Поэтому режиму ремонта на этой
    // поверхности нужна та же заглушка, что и остальным отказам: комментарии и
    // ненулевой выход на диалекте, который просили.
    if (pathname.endsWith('/raw')) {
      const dialect = normalizeDialect(req.nextUrl.searchParams.get('lang'))
      return new NextResponse(errorScript(dialect, [MAINTENANCE_LINE]), {
        status: 503,
        headers: {
          'Retry-After': RETRY_AFTER_SEC,
          'Content-Type': dialectMime(dialect),
          'SF-Reason': 'maintenance',
          'Cache-Control': 'no-store',
        },
      })
    }
    return new NextResponse(`${MAINTENANCE_LINE}\n`, {
      status: 503,
      headers: {
        'Retry-After': RETRY_AFTER_SEC,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        // Причина машинно: 503 бывает разным (ремонт, перегрузка, отказ вышестоящего), и
        // клиенту важно отличить «вернись позже, у нас работы» от «что-то сломалось».
        // Скриптовая ветка выше этот заголовок ставит — здесь его не было, хотя адресат
        // тот же машинный.
        'SF-Reason': 'maintenance',
      },
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
  // БД-флаг и jose требуют Node (edge не умеет pg).
  runtime: 'nodejs',
  // Всё, кроме ассетов сборки и статики корня (иконки/манифест).
  matcher: ['/((?!_next/|favicon\\.ico|icon\\.|apple-icon|manifest\\.).*)'],
}
