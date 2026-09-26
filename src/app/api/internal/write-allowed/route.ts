// eslint-disable-next-line no-restricted-imports -- внутренний канал ядро→фронт: своя авторизация общим токеном, не cookie-сессия
import { getListMeta } from '@/features/library/queries'
import { canEditList, editBlockReason } from '@/core'
import { findDestructiveInScript, findDestructiveSteps } from '@/core/domain/destructive-command'
import { findSecret, findSecretInFile } from '@/core/domain/secret-scan'

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
 *
 * # Второй вопрос: БЕЗОПАСНО ЛИ ЭТО СОДЕРЖИМОЕ (H15-002)
 *
 * Запрет исполняемых команд (`assertNoDestructiveSteps`) стоит на фасаде
 * `ListStore` — через него идут редактор, MCP, генерация, садовник и предложения.
 * `git push` версию создаёт МИМО фасада: пак принимает ядро, оно же проецирует
 * коммит в версию. Ядро при этом судит только ФОРМУ (pre-receive: удаление main,
 * non-fast-forward, обязательный list.json, allowlist путей дерева), а `content`
 * блока хранит непрозрачным JSON — про содержимое команд там нет ничего.
 *
 * Поэтому вопрос задаётся ТУТ ЖЕ, на том же канале и тем же правилом: решает
 * приложение (набор правил — политика безопасности на TS, с кодами причин для
 * словаря автора), принуждает ядро. Копии правила в Rust не заводим — две копии
 * одной политики в этом проекте уже расходились (RULES против RISKY), и цена
 * известна.
 *
 * ⚠️ Набор здесь РОВНО ТОТ ЖЕ, что на фасаде: `findDestructiveSteps` (RULES —
 * запрет), а не `findRisky` (RISKY — пометка). Строже редактора этот вход быть не
 * имеет права: пуш — рабочий путь, и отказ в нём, которого не было бы у той же
 * правки из формы, стоит человеку потерянной работы.
 *
 * Отказ НАЗЫВАЕТ МЕСТО: номер шага (с единицы, как у `DestructiveCommandError`),
 * код правила и совпавший кусок команды, — чтобы `pre-receive` напечатал человеку
 * не «нельзя», а какой пункт и какая команда.
 *
 * ⚠️ Половина, которой здесь нет: блоки в запрос кладёт ЯДРО (setfork-core,
 * `git/bundle.rs` + `gate.rs`), разобрав `list.json` пушнутого коммита своим уже
 * существующим парсером (`git/project.rs`, `RawStep.command`). Без `blocks` ответ
 * побайтово прежний — старое ядро и окно выкатки этот вход не ломают.
 *
 * # Третий вопрос: НЕТ ЛИ В КОММИТЕ КЛЮЧА ДОСТУПА
 *
 * `files` — тексты файлов пушнутого коммита: `list.json` и файлы автора целиком, по
 * пути. Команд тут мало: ключ утекает из описания шага и из `references/setup.md`
 * так же, как из команды. Правило — то же, что на фасаде (`secret-scan.ts`), отказ
 * называет файл и строку, как push protection у GitHub. Старое ядро `files` не шлёт —
 * тогда проверяются только команды шагов, лучше, чем ничего.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Блок списка в вопросе ядра. Не-step блоки команды не несут и проходят. */
interface AskedBlock {
  command?: unknown
}

/** Файл коммита в вопросе ядра: путь в дереве и текст. */
interface AskedFile {
  path: string
  text: string
}

type Verdict =
  | { allow: true }
  | { allow: false; reason: 'archived' | 'frozen' | 'not-found' }
  /** Запрещённая команда: причина + МЕСТО (шаг с единицы, код правила, фрагмент). */
  | { allow: false; reason: 'destructive'; step: number; rule: string; fragment: string; path?: string }
  /** Ключ доступа: файл и строка (у команды шага — `step`), вид ключа и его НАЧАЛО. */
  | { allow: false; reason: 'secret'; path: string; step: number; line: number; rule: string; provider: string; fragment: string }

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

/**
 * Блоки из тела запроса: `undefined` — ядро не спрашивало про содержимое (старое
 * ядро либо операция без пака), `null` — спросило, но форма не та.
 *
 * Форму различаем СТРОГО, а мягкость оставляем полям: массив не массив — это
 * расхождение контракта, и открывать дверь на нём нельзя (ядро прочтёт 4xx как
 * «ответ непонятен» и откажет). А вот блок без команды или с нестроковой
 * командой — обычный не-step блок, он проходит, как проходит в любом другом
 * пути записи.
 */
function readBlocks(raw: unknown): AskedBlock[] | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return null
  return raw.map((b) => (b && typeof b === 'object' ? (b as AskedBlock) : {}))
}

/** Файлы из тела: `undefined` — не спрашивали, `null` — форма не та (как у блоков). */
function readFiles(raw: unknown): AskedFile[] | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return null
  const out: AskedFile[] = []
  for (const f of raw) {
    if (!f || typeof f !== 'object') return null
    const { path, text } = f as { path?: unknown; text?: unknown }
    if (typeof path !== 'string' || typeof text !== 'string') return null
    out.push({ path, text })
  }
  return out
}

export async function POST(req: Request) {
  if (!channelOk(req)) return new Response('Unauthorized', { status: 401 })

  let body: { owner?: unknown; slug?: unknown; blocks?: unknown; files?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const owner = typeof body.owner === 'string' ? body.owner : ''
  const slug = typeof body.slug === 'string' ? body.slug : ''
  if (!owner || !slug) return new Response('Bad request', { status: 400 })
  const blocks = readBlocks(body.blocks)
  if (blocks === null) return new Response('Bad request', { status: 400 })
  const files = readFiles(body.files)
  if (files === null) return new Response('Bad request', { status: 400 })

  const meta = await getListMeta(owner, slug)
  // Списка нет — писать некуда. Отдаём вердикт, а не 404: для ядра это такой же
  // ответ «нельзя», и различать транспортную ошибку от продуктовой не придётся.
  if (!meta) return json({ allow: false, reason: 'not-found' })

  // Состояние списка — ПЕРВЫМ: если писать нельзя вовсе, содержимое не при чём, и
  // человеку надо сказать про архив, а не про команду в шаге.
  if (!canEditList(meta)) {
    // editBlockReason здесь не может вернуть null: canEditList уже сказал «нельзя».
    return json({ allow: false, reason: editBlockReason(meta) ?? 'frozen' })
  }

  if (blocks) {
    const found = findDestructiveSteps(blocks.map((b) => ({ command: typeof b.command === 'string' ? b.command : null })))
    const first = found[0]
    if (first) {
      return json({ allow: false, reason: 'destructive', step: first.index + 1, rule: first.match.reason, fragment: first.match.fragment })
    }
  }

  // Скрипты из `files` — тем же правилом, что на фасаде (`findDestructiveInScript`): шелл
  // целиком, Python/JS — по командам, отданным на исполнение. Место — файл.
  for (const f of files ?? []) {
    if (!/^scripts\//.test(f.path)) continue
    const hit = findDestructiveInScript(f.path, f.text)
    if (hit) return json({ allow: false, reason: 'destructive', step: 0, rule: hit.reason, fragment: hit.fragment, path: f.path })
  }

  for (const [i, b] of (blocks ?? []).entries()) {
    const hit = typeof b.command === 'string' ? findSecret(b.command) : null
    if (hit) return json({ allow: false, reason: 'secret', path: '', step: i + 1, line: hit.line, rule: hit.rule, provider: hit.provider, fragment: hit.fragment })
  }
  for (const f of files ?? []) {
    const hit = findSecretInFile(f.path, f.text)
    if (hit) return json({ allow: false, reason: 'secret', path: f.path, step: 0, line: hit.line, rule: hit.rule, provider: hit.provider, fragment: hit.fragment })
  }

  return json({ allow: true })
}
