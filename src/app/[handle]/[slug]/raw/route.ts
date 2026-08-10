import { getLang } from '@/shared/i18n/server'
import { requireViewableDetail, requireViewableDetailFor } from '@/features/library/guard'
import { scriptRefusal, toRunnableScript, toExportList } from '@/features/library/export'
import {
  AUTHORED_DIALECT,
  dialectMime,
  dialectSpec,
  errorScript,
  normalizeDialect,
  scriptFilename,
  type ScriptDialect,
} from '@/core/domain/script-dialect'
import { isPubliclyVisible } from '@/core'
import { appOrigin } from '@/shared/auth/app-origin'
import { verifyApiToken } from '@/shared/auth/api-token'
import { clientIp, rateLimit } from '@/shared/rate-limit'
import { cacheHeaders, noStoreHeaders, notModified } from '@/shared/http/cache'

/**
 * GET /{handle}/{slug}/raw[?lang=sh|ps1|py] — СПИСОК КАК ИСПОЛНЯЕМЫЙ СКРИПТ (gist-стиль).
 *
 *   curl -fsSL "https://host/{owner}/{slug}/raw" | bash
 *
 * `?lang=` выбирает ДИАЛЕКТ ОБЁРТКИ, и обёртка не переводит авторские команды: списку
 * с исполняемыми командами чужой диалект отвечает 406, а не скриптом (см. ниже и
 * `core/domain/script-dialect`).
 *
 * Машинный контракт держится ТЕМ ЖЕ набором правил, что у близнеца `data.json`: тот отдаёт
 * список как данные, этот — как код. Раньше правила были только у близнеца, и правки,
 * сделанные там по находкам авто-ревью (общий кеш только для публично видимого, язык в
 * ключе кеша), в эту половину пары не переносили. Здесь не было ни кеш-политики, ни ETag,
 * ни разбора Authorization, ни лимита частоты — при том, что отдаётся исполняемый код.
 */
export const runtime = 'nodejs'

/**
 * ОТКАЗ МАШИННОЙ ПОВЕРХНОСТИ — ЕДИНСТВЕННАЯ форма любого не-200 ответа.
 *
 * Тело этого ответа читает не человек, а интерпретатор: `curl … | bash` исполняет
 * всё, что пришло. Обычная строка («Not found», JSON про rate limit) в шелле — это
 * команда, а не сообщение. Поэтому отказ всегда одинаков: валидная для диалекта
 * заглушка из комментариев, кончающаяся ненулевым выходом. Причина едет ещё и
 * заголовком — машине незачем разбирать текст, написанный для глаз.
 *
 * Одна функция на все статусы намеренно: разойдись они, ровно один забытый путь и
 * вернул бы отказ, который выглядит как успешный прогон.
 */
const refuse = (
  dialect: ScriptDialect,
  status: number,
  reason: string,
  message: string[],
  extraHeaders: Record<string, string> = {},
) =>
  new Response(errorScript(dialect, message), {
    status,
    headers: { 'Content-Type': dialectMime(dialect), 'SF-Reason': reason, ...extraHeaders, ...noStoreHeaders() },
  })

export async function GET(req: Request, { params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  const u = new URL(req.url)
  const dialect = normalizeDialect(u.searchParams.get('lang'))
  const mime = dialectMime(dialect)

  // Частотный лимит по IP: транспорт публичный, без аутентификации, и его дёргают в цикле.
  // Тот же бюджет, что у близнеца — один контракт на обе машинные поверхности.
  // Общий `tooMany` здесь не годится: он отдаёт JSON, а JSON в шелле — не сообщение,
  // а текст, который интерпретатор попытается исполнить.
  const rate = await rateLimit(`list-raw:${clientIp(req)}`, 120, 60_000)
  if (!rate.ok) {
    return refuse(
      dialect,
      429,
      'rate_limited',
      [`SetFork: too many requests for ${handle}/${slug}.`, `Retry after ${rate.retryAfter} seconds.`],
      { 'Retry-After': String(rate.retryAfter) },
    )
  }

  // Токен важнее сессии: если он передан, читаем ОТ ЕГО ВЛАДЕЛЬЦА. Предъявленный кредитив
  // обязан быть либо принят, либо отклонён — раньше заголовок не читался вовсе, поэтому
  // отозванный токен получал 200 как аноним (отзыв на этой поверхности был ненаблюдаем),
  // а владелец приватного списка не мог забрать собственный скрипт ничем, кроме браузера.
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const auth = bearer ? await verifyApiToken(bearer) : null
  if (bearer && !auth) return refuse(dialect, 401, 'invalid_token', ['SetFork: the API token was rejected.'])

  const [lang, detail] = await Promise.all([
    getLang(),
    auth ? requireViewableDetailFor(handle, slug, auth.userId) : requireViewableDetail(handle, slug),
  ])
  // Приватный список без прав неотличим от несуществующего — та же политика, что у близнеца.
  // Поэтому в теле НЕТ ни адреса, ни слага: иначе два отказа отличались бы друг от друга
  // и по разнице было бы видно, существует список или нет.
  if (!detail) return refuse(dialect, 404, 'not_found', ['SetFork: no such list, or it is not visible to you.'])

  // Происхождение и команда повторного запуска — из КОНФИГУРАЦИИ, а не из адреса запроса.
  // На проде `req.url` строится из адреса привязки сервера, и скрипт называл своим
  // источником `https://0.0.0.0:3000`: артефакт не имел проверяемого происхождения, а
  // напечатанная в нём команда запуска была нерабочей.
  const rawUrl = `${appOrigin()}/${handle}/${slug}/raw`
  // Выбор пунктов: ?bid=<id> (можно несколько раз) или ?bids=a,b. Справочник на
  // тридцать пунктов не нужно тащить целиком ради одного — тот же адрес блока,
  // что отдаёт get_list. Неизвестный адрес — явный отказ, а не тихо весь список.
  const list = toExportList(detail)
  const only = [...u.searchParams.getAll('bid'), ...(u.searchParams.get('bids') ?? '').split(',')]
    .map((b) => b.trim())
    .filter(Boolean)
  const known = new Set(list.steps.flatMap((s) => (s.bid ? [s.bid] : [])))
  const unknown = only.filter((b) => !known.has(b))
  if (unknown.length) {
    return refuse(dialect, 404, 'unknown_block', [`SetFork: no such block in ${handle}/${slug}: ${unknown.join(', ')}.`])
  }

  // ДИАЛЕКТ НЕ ПЕРЕВОДИТ КОМАНДЫ. `?lang=py` меняет только обёртку — shebang,
  // print(), расширение, MIME, — а поле `command` вставляет как есть. Авторская
  // `export FOO=bar`, конвейер или heredoc не становятся Python оттого, что сверху
  // приписали `#!/usr/bin/env python3`: скрипт либо не компилируется целиком, либо —
  // что хуже — в другом интерпретаторе значит другое. Модель списка runtime не
  // объявляет (см. AUTHORED_DIALECT), поэтому чужой диалект авторских команд не
  // получает вовсе. Списку без исполняемых команд отказывать не за что: там вся
  // обёртка — комментарии и печать прогресса, и она честна на любом диалекте.
  const refusal = scriptRefusal(list, dialect, { only })
  if (refusal) {
    // Предлагаемая команда — с той же выборкой пунктов, что просили, и от
    // КОНФИГУРАЦИИ (rawUrl), а не от адреса запроса: на проде `req.url` собран из
    // адреса привязки сервера и подсказка была бы нерабочей. Собираем строкой, а не
    // через `new URL`: разбор кинул бы TypeError на кривом APP_URL, и вместо отказа
    // машинная поверхность отдала бы 500.
    const shellQuery = new URLSearchParams()
    u.searchParams.forEach((v, k) => {
      if (k !== 'lang') shellQuery.append(k, v)
    })
    const qs = shellQuery.toString()
    return refuse(dialect, 406, refusal, [
      `SetFork: no ${dialect} script for ${handle}/${slug}.`,
      'Its steps carry shell commands, and this endpoint does not translate commands',
      'between languages — that would hand you code meaning something else.',
      `Run the shell form instead:  ${dialectSpec(AUTHORED_DIALECT).run(qs ? `${rawUrl}?${qs}` : rawUrl, scriptFilename(slug, AUTHORED_DIALECT))}`,
    ])
  }

  const version = detail.currentVersion?.version ?? detail.tpl.currentVersion
  const updatedAt = detail.tpl.updatedAt ?? new Date(0)
  // Выборка — часть ответа, значит и часть ключа кеша: без неё общий прокси отдал
  // бы скрипт одного пункта тому, кто просил другой.
  const etag = `W/"v${version}-${updatedAt.getTime()}-${lang}-${dialect}${only.length ? `-${only.join('.')}` : ''}"`

  // Общий кеш — только для того, что вправе увидеть аноним, и предикат единый:
  // собственная проверка «публичный и не черновик» пропускала МОДЕРАЦИЮ, и общий прокси
  // раздал бы анониму скрытое содержимое, ни разу не спросив guard.
  // Язык текста здесь ДОГОВОРНЫЙ: `?lang=` у этой поверхности выбирает диалект скрипта,
  // а не язык шагов — тот приходит из куки и Accept-Language, и кеш обязан их различать.
  const shared = isPubliclyVisible(detail.tpl) && !auth
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Disposition': `inline; filename="${scriptFilename(slug, dialect)}"`,
    ...cacheHeaders({ shared, etag, negotiated: true }),
  }

  // Условный запрос: у машинной поверхности, которую опрашивают в цикле, повторный
  // ответ не должен стоить ни генерации, ни трафика.
  const cached = notModified(req, etag, headers)
  if (cached) return cached

  return new Response(toRunnableScript(list, lang, rawUrl, dialect, { only }), { headers })
}
