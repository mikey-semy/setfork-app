// eslint-disable-next-line no-restricted-imports -- внутренний канал ядро→фронт: своя авторизация общим токеном, не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { canEditList, editBlockReason } from '@/core'

/**
 * Внутренний эндпоинт «можно ли писать в этот список» — ядро спрашивает перед
 * КАЖДОЙ мутирующей git-операцией (ADR-0015).
 *
 * Зачем он есть: правило «замороженный и архивный список не изменить» знает
 * только приложение, а обойти его не должен НИ ОДИН путь записи. Раньше проверка
 * стояла в git-роуте, и линза 02 доказала живьём, что прод (Rust-ядро) её обходит.
 * Теперь решает по-прежнему фронт, а принуждает ядро — точно так же, как
 * pre-receive у Gitaly спрашивает Rails через /internal/allowed.
 *
 * Направление вызова ОБРАТНОЕ обычному (обычно фронт зовёт ядро), поэтому здесь
 * не сессия и не пользовательский токен, а тот же общий токен канала
 * SETFORK_CORE_TOKEN. Наружу эндпоинт не публикуется.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Verdict = { allow: true } | { allow: false; reason: 'archived' | 'frozen' | 'not-found' }

const json = (v: Verdict, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

/** Канал закрыт тем же токеном, что gRPC. Сравнение полное; constant-time не нужен
 *  по тем же причинам, что и в ядре: токен длинный и случайный. Токен не задан —
 *  канал открыт (локальный dev), это зеркалит поведение SETFORK_ALLOW_INSECURE. */
function channelOk(req: Request): boolean {
  const expected = process.env.SETFORK_CORE_TOKEN
  if (!expected) return true
  return req.headers.get('authorization') === `Bearer ${expected}`
}

export async function POST(req: Request) {
  if (!channelOk(req)) return new Response('Unauthorized', { status: 401 })

  let body: { owner?: unknown; slug?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const owner = typeof body.owner === 'string' ? body.owner : ''
  const slug = typeof body.slug === 'string' ? body.slug : ''
  if (!owner || !slug) return new Response('Bad request', { status: 400 })

  const meta = await getListMeta(owner, slug)
  // Списка нет — писать некуда. Отдаём вердикт, а не 404: для ядра это такой же
  // ответ «нельзя», и различать транспортную ошибку от продуктовой не придётся.
  if (!meta) return json({ allow: false, reason: 'not-found' })

  if (canEditList(meta)) return json({ allow: true })
  // editBlockReason здесь не может вернуть null: canEditList уже сказал «нельзя».
  return json({ allow: false, reason: editBlockReason(meta) ?? 'frozen' })
}
