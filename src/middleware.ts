import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { isLang, DEFAULT_LANG, LANG_COOKIE, t, type Lang } from '@/shared/i18n'
import { negotiateLang } from '@/shared/i18n/negotiate'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { maintenanceEnabled } from '@/shared/settings/maintenance'
import { REQUEST_PATH_HEADER } from '@/shared/request-path'
import { LANG_HEADER, splitLangPath } from '@/shared/i18n/url'
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
 * ЯЗЫК ИЗ АДРЕСА: `/ru/explore` рисуется тем же маршрутом, что `/explore`, но по-русски.
 *
 * Зачем: до сентября 2026 языки жили по ОДНОМУ адресу, а выбирал `Accept-Language`.
 * YandexBot его не шлёт и всегда получал английскую страницу — русского SetFork в
 * индексе не существовало вовсе (аудит 22.09.2026, работа 1).
 *
 * Почему переписыванием, а не каталогом `app/[lang]/`: маршрутов и страниц под сотню,
 * и физический перенос — это огромная правка ради одного сегмента адреса. Переписывание
 * даёт ровно то, что нужно поисковику (свой адрес у каждого языка), не трогая структуру.
 *
 * Язык едет рендеру ДВУМЯ путями, и оба нужны:
 *  • заголовком запроса — для ЭТОГО ответа: кука, поставленная ответом, текущий рендер
 *    уже не видит;
 *  • кукой — для СЛЕДУЮЩИХ переходов. Внутренние ссылки идут без префикса
 *    (`/explore`), а корневой layout при клиентском переходе не перерисовывается. Без
 *    куки гость, пришедший по `/ru/…`, первым же кликом получал страницу на языке
 *    своего `Accept-Language`, а шапка оставалась русской — две половины экрана на
 *    разных языках (находка авто-ревью к SEO-1).
 *
 * Куку ставим, как next-intl: только когда язык адреса РАСХОДИТСЯ с тем, что и так
 * выбралось бы (кука, иначе `Accept-Language`). Совпадает — писать нечего. Атрибуты те
 * же, что у переключателя языка в шапке: это тот же выбор, сделанный переходом по ссылке.
 * Роботу кука ничего не меняет — он её не хранит и каждый адрес получает по префиксу.
 */
function stripLangPrefix(req: NextRequest): NextResponse | null {
  const { lang, rest } = splitLangPath(req.nextUrl.pathname)
  if (!lang) return null
  const url = req.nextUrl.clone()
  url.pathname = rest
  const headers = new Headers(req.headers)
  headers.set(LANG_HEADER, lang)
  // ⚠️ Путь БЕЗ префикса. Его читает сверка переехавших адресов (`moved-list.ts`), а она
  // сравнивает с адресом, записанным при переезде, — там префикса нет и быть не может.
  // С префиксом сравнение не совпадало НИКОГДА, и старая ссылка вида `/ru/old/list`
  // уводила не туда, куда переехал список (находка авто-ревью).
  //
  // Язык при этом не теряется: он приезжает отдельным заголовком выше, и метаданные
  // собирают из этой пары и адрес своего языка, и `hreflang`.
  headers.set(REQUEST_PATH_HEADER, rest + req.nextUrl.search)
  const res = NextResponse.rewrite(url, { request: { headers } })
  const cookie = req.cookies.get(LANG_COOKIE)?.value
  const current = isLang(cookie) ? cookie : negotiateLang(req.headers.get('accept-language'))
  if (current !== lang) {
    res.cookies.set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  }
  return res
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
  // Период раздела убран (он давал одну и ту же выдачу на всех значениях), поэтому
  // старые адреса с `?range=` ведут на саму страницу, а не тащат мёртвый параметр.
  return '/trending'
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

/** Адреса проб: отвечают САМИ и до любого обращения к базе. Один набор, чтобы новый
 *  адрес пробы нельзя было завести, забыв про обход. */
const PROBE_PATHS = new Set(['/api/health', '/api/ready', '/healthz'])

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
  // ⚠️ `/healthz` — ТОТ ЖЕ ОБХОД. Это общепринятый адрес пробы, и внешний монитор ходит
  // именно туда. Без этой строки он не начинается с `/api/`, значит в ремонте уходит в
  // ЧЕЛОВЕЧЕСКУЮ ветку и отвечает 503 с HTML-страницей: балансировщик выкидывает живой
  // экземпляр из ротации — та самая цепочка unhealthy → Traefik → 404 на весь сайт, от
  // которой предостерегает абзац выше.
  //
  // Хуже того, при ЗАВИСШЕЙ (а не отказавшей) базе `maintenanceEnabled()` своего
  // предела ожидания не имеет: проба перевалила бы за таймаут и здоровый контейнер
  // получил бы перезапуск. Ровно перевёрнутый сигнал, ради починки которого адрес и
  // заведён.
  if (PROBE_PATHS.has(pathname)) return pass(req)

  // ⚠️ Префикс снимаем ДО режима ремонта и до всего прочего: иначе `/ru/...` не совпадёт
  // ни с одним известным маршрутом и уйдёт в 404, а на ремонте — мимо заглушки.
  const langed = stripLangPrefix(req)
  if (langed) return langed

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
