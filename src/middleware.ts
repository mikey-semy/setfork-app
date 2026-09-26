import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { isLang, DEFAULT_LANG, LANG_COOKIE, LANG_COOKIE_OPTIONS, t, type Lang } from '@/shared/i18n'
import { preferredLang } from '@/shared/i18n/negotiate'
import { isAdminHandle } from '@/shared/auth/admin-handle'
import { maintenanceEnabled } from '@/shared/settings/maintenance'
import { REQUEST_PATH_HEADER } from '@/shared/request-path'
import { splitLangPath } from '@/shared/i18n/url'
import { dialectMime, errorScript, normalizeDialect } from '@/core/domain/script-dialect'
import { indexNowKey, indexNowKeyPath } from '@/shared/indexnow'
import { CSP_HEADER, NONCE_HEADER, cspNonce, cspPolicy } from '@/shared/security/csp'

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
 * Одноразовый nonce и политика скриптов — в запрос и в ответ.
 *
 * В ЗАПРОС: по заголовку политики Next.js вешает nonce на свои скрипты, по `x-nonce`
 * его берёт корневой layout для наших. ⚠️ Оба заголовка ставятся ВСЕГДА, поверх
 * присланных клиентом: иначе nonce выбирал бы тот, кто шлёт запрос, и политика
 * пропускала бы его скрипт.
 * В ОТВЕТ: та же политика.
 */
function withCsp(headers: Headers): (res: NextResponse) => NextResponse {
  const nonce = cspNonce()
  const policy = cspPolicy(nonce)
  // Next берёт nonce из `Content-Security-Policy` ПРЕЖДЕ `…-Report-Only`: присланный
  // клиентом боевой заголовок выбирал бы nonce для скриптов Next поверх нашего.
  headers.delete('content-security-policy')
  headers.set(NONCE_HEADER, nonce)
  headers.set(CSP_HEADER, policy)
  return (res) => {
    res.headers.set(CSP_HEADER, policy)
    return res
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
  const csp = withCsp(headers)
  return csp(NextResponse.next({ request: { headers } }))
}

/**
 * Переписать запрос на другой маршрут, сообщив рендеру ИСХОДНЫЙ путь (см. `pass`): сверка
 * переехавших адресов и канон считают от того, что человек открыл, а не от цели переписывания.
 */
function rewrite(req: NextRequest, target: string): NextResponse {
  const headers = new Headers(req.headers)
  headers.set(REQUEST_PATH_HEADER, req.nextUrl.pathname + req.nextUrl.search)
  // Заголовки запроса дописываются ДО того, как Next их заберёт.
  const csp = withCsp(headers)
  return csp(NextResponse.rewrite(new URL(target, req.url), { request: { headers } }))
}

/**
 * АДРЕСА С ЯЗЫКОВЫМ ПРЕФИКСОМ — ПОСТОЯННЫЙ ПЕРЕХОД НА АДРЕС БЕЗ НЕГО.
 *
 * Языка в адресе нет (ADR-0029, 25.09.2026): адрес страницы один на все языки. С 22 по
 * 25.09 были адреса `/ru/…` и `/en/…` (#950, #959) — они в индексе и во внешних ссылках,
 * поэтому перенаправляем, а не отдаём 404.
 *
 * ⚠️ 308, а не 301: оба постоянные, но 308 сохраняет метод. Вкладка, открытая до выкатки
 * по `/ru/…`, шлёт серверное действие POST-ом на этот же адрес — 301 превратил бы его в GET,
 * и действие молча не выполнилось бы.
 *
 * Язык прежнего адреса не теряется: человеку ставится кука, как у переключателя в шапке, —
 * иначе пришедший по русской ссылке увидел бы интерфейс на языке своего браузера. Ставим
 * только когда язык адреса расходится с тем, что выбралось бы и так (кука, иначе
 * `Accept-Language`): совпадает — писать нечего. Роботу кука ничего не меняет.
 */
function dropLangPrefix(req: NextRequest, lang: Lang, rest: string): NextResponse {
  const res = NextResponse.redirect(new URL(rest + req.nextUrl.search, req.url), 308)
  // ⚠️ Не кешировать: решение о куке зависит от запроса (кука, `Accept-Language`), а 308
  // браузер хранит долго и отдаёт из кеша уже без `Set-Cookie` — язык стал бы зависеть от
  // истории браузера. Постоянство для поисковика задаёт код, а не кеш.
  res.headers.set('Cache-Control', 'private, no-store')
  const cookie = req.cookies.get(LANG_COOKIE)?.value
  // Язык, который зритель назвал САМ; не назвал (робот, пустой `Accept-Language`) — `null`, и кука
  // ставится всегда: без неё страница выбрала бы язык по содержимому списка, а не прежнего адреса.
  const current = isLang(cookie) ? cookie : preferredLang(req.headers.get('accept-language'))
  if (current !== lang) res.cookies.set(LANG_COOKIE, lang, LANG_COOKIE_OPTIONS)
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
function legacyExploreTarget(pathname: string, params: URLSearchParams): string | null {
  if (pathname !== '/explore') return null
  const tab = params.get('tab')
  if (tab === 'topics') return '/tags'
  if (tab === 'collections') return '/collections'
  if (tab !== 'trending') return null
  if (params.get('view') === 'people') return '/trending/people'
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
function markdownSuffixTarget(pathname: string): string | null {
  const m = /^\/([^/]+)\/([^/]+)\.md$/.exec(pathname)
  if (!m) return null
  const [, handle, slug] = m
  return `/${handle}/${slug}/export?format=md`
}

/** Адреса проб: отвечают САМИ и до любого обращения к базе. Один набор, чтобы новый
 *  адрес пробы нельзя было завести, забыв про обход. */
const PROBE_PATHS = new Set(['/api/health', '/api/ready', '/healthz'])

export async function middleware(req: NextRequest) {
  // ФАЙЛ КЛЮЧА INDEXNOW — первым делом, по ПОЛНОМУ пути. Он обязан лежать в корне
  // (`/<key>.txt`): ключ в подкаталоге подтверждал бы только адреса под ним. Корень занят профилями
  // (`/[handle]`), поэтому отвечаем здесь, без базы и без ремонта: поисковик проверяет
  // ключ, пока сайт на обслуживании, и отказ там стоил бы отказа всей пачки (403).
  // Любой другой `*.txt` идёт дальше как раньше.
  const key = indexNowKey()
  if (key && req.nextUrl.pathname === indexNowKeyPath(key)) {
    return new NextResponse(key, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  const { lang: urlLang, rest } = splitLangPath(req.nextUrl.pathname)
  if (urlLang) return dropLangPrefix(req, urlLang, rest)
  const pathname = req.nextUrl.pathname
  const go = (target?: string) => (target ? rewrite(req, target) : pass(req))

  const legacy = legacyExploreTarget(pathname, req.nextUrl.searchParams)
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
  if (PROBE_PATHS.has(pathname)) return go()

  if (!(await maintenanceEnabled())) {
    // ⚠️ `.md` ПОСЛЕ проверки режима, а не до неё. Стоя выше, переписывание отдавало
    // 200 с полным содержимым и продолжало ходить в базу ровно тогда, когда режим
    // обслуживания существует, чтобы база молчала. Машинная поверхность — не повод
    // обходить ремонт: `/raw` и `/api/` его не обходят.
    return go(markdownSuffixTarget(pathname) ?? undefined)
  }
  // Дверь для админа: страница входа и auth-эндпоинты (GitHub OAuth, POST
  // server actions самого /login) остаются открыты.
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) return go()

  if (await isAdminRequest(req)) return go()

  // Машинные поверхности — короткий text/plain (curl, git, MCP, ридеры фидов).
  const machine =
    pathname.startsWith('/api/') ||
    pathname.endsWith('.bundle') ||
    // `.md` — тоже машинная поверхность: этот адрес мы САМИ рекламируем агентам в
    // llms.txt («допишите .md к адресу»). Человеческая заглушка ремонта им не нужна.
    pathname.endsWith('.md') ||
    pathname.endsWith('/raw') ||
    // Скилл архивом: его распаковывает программа, а не читает человек (`SKILL.md`
    // попадает сюда по окончанию `.md` строкой выше).
    pathname.endsWith('/skill.tar.gz') ||
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

  const raw = req.cookies.get(LANG_COOKIE)?.value ?? ''
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
