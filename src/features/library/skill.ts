// Список → скилл по стандарту Agent Skills (agentskills.io/specification).
//
// Чистые функции: ни базы, ни сети. Всё, что знает только маршрут (адрес сайта,
// подпись версии, уровень проверки, последний прогон), приходит в `SkillContext`.
import { tr, type Lang } from '@/shared/i18n'
import type { AuthoredFile } from '@/core'
import { translitRu } from '@/shared/lib/translit'
import { markdownCodeBlock } from '@/shared/lib/markdown'
import { safeHref } from '@/shared/lib/safe-url'
import { stepDanger } from '@/core/domain/destructive-command'
import { blockText } from './blocks'
import { isStepBlk, toRunnableScript, type ExportList, type ExportStep } from './export'

/** Пределы стандарта для шапки `SKILL.md`. */
export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 1024
/** Рекомендация стандарта: тело длиннее — повод вынести справку в `references/`. */
export const SKILL_BODY_LINES_ADVISED = 500

export const SKILL_CONTEXT_PATH = 'references/context.md'
export const SKILL_SCRIPT_PATH = 'scripts/run.sh'

export interface SkillContext {
  /** Адрес сайта без слеша на конце — из конфигурации, а не из адреса запроса. */
  origin: string
  /** Подпись версии из ядра. Нет — строки в шапке нет (как в экспорте в markdown). */
  commitSha?: string | null
  /** Уровень проверки текущей версии (`rock`, `machine_run`, …). */
  verification?: string | null
  /** Последний прогон текущей версии. Нет прогона — нет и строки. */
  lastRun?: { verdict: string; passed: number; total: number; at: Date } | null
  /** Авторские файлы версии из git-дерева (ADR-0028). Нет — скилл собирается из блоков. */
  authored?: AuthoredFile[] | null
}

export interface SkillFile {
  path: string
  /** Сгенерированное — строкой, авторское — байтами как в git. */
  content: string | Uint8Array
  /** Исполняемый файл — в архиве получает права 0755. */
  executable?: boolean
}

export interface Skill {
  name: string
  files: SkillFile[]
  /** Текст `SKILL.md` — для проверки длины, без поиска по `files`. */
  markdown: string
  /** Авторские файлы, которые в архив не легли (путь не по формату). Маршрут пишет их в
   *  журнал: пропуск не должен быть молчаливым. */
  skipped: string[]
}

/** Путь авторского файла — ровно `<каталог>/<имя>`, как принимает ядро (ADR-0028). */
export const AUTHORED_PATH = /^(scripts|references|assets)\/[^/]+$/
/** Имя файла в заголовке ustar — не длиннее 100 байт (каталоги уходят в поле `prefix`).
 *  Запись ядро с 24.09 держит тем же пределом (`AUTHORED_NAME_MAX_BYTES`); пушем длинное
 *  имя пройти ещё может — его и отсеивает архив. Кириллица набирает 100 байт на ~50 знаках. */
const TAR_NAME_MAX_BYTES = 100
export const fitsArchive = (path: string): boolean => new TextEncoder().encode(path.slice(path.lastIndexOf('/') + 1)).length <= TAR_NAME_MAX_BYTES

/**
 * Авторские файлы, которые можно положить в архив.
 *
 * Ядро пускает в дерево только такие пути, но архив их проверяет сам: `tarGz` на
 * небезопасном пути бросает исключение, и одно кривое имя уронило бы маршрут в 500
 * вместо архива. Неподходящее отбрасывается, остальное уходит как есть.
 */
function authoredOf(ctx: SkillContext): AuthoredFile[] {
  return (ctx.authored ?? []).filter((f) => AUTHORED_PATH.test(f.path) && !f.path.split('/').includes('..') && fitsArchive(f.path))
}

/**
 * ИМЯ СКИЛЛА ИЗ СЛАГА по правилам стандарта: 1–64 знака, только `a-z`, `0-9` и `-`,
 * без дефиса по краям и без двух дефисов подряд.
 *
 * Слаг почти всегда уже такой — но не всегда. Он режется до 60 знаков ПОСЛЕ того, как
 * срезаны крайние дефисы, поэтому длинный заголовок оставляет дефис на конце:
 * `skripty-obsluzhivaniya-servera-chto-est-chto-delaet-i-kogda-`. Стандарт такое имя
 * отвергает, а оно ещё и обязано совпасть с именем папки. Кириллица транслитерируется
 * тем же правилом, что строит слаги, а не вырезается: из «проверка» иначе вышел бы `-`.
 */
export function skillName(slug: string): string {
  const clean = (s: string) => s.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  const name = clean(clean(translitRu(slug).replace(/[^a-z0-9-]/g, '-')).slice(0, SKILL_NAME_MAX))
  return name || 'setfork-list'
}

/**
 * ОПИСАНИЕ — описание списка, а у списка без описания его название. По нему агент решает,
 * включать ли скилл, поэтому пустым оно быть не может.
 *
 * Режется по ГРАНИЦЕ СЛОВА и считается в знаках, а не в единицах UTF-16: так считает и
 * валидатор стандарта, и разрез посреди суррогатной пары дал бы битый символ.
 * «Когда применять» стандарт тоже просит, но откуда его брать — решение владельца, и
 * до него поле не выдумывается.
 */
export function skillDescription(list: ExportList, lang: Lang): string {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  const text = flat(tr(list.desc, lang)) || flat(tr(list.title, lang)) || skillName(list.slug)
  const chars = Array.from(text)
  if (chars.length <= SKILL_DESCRIPTION_MAX) return text
  const cut = chars.slice(0, SKILL_DESCRIPTION_MAX - 1)
  const lastSpace = cut.lastIndexOf(' ')
  // Слово длиннее всего предела (ссылка, код) — режем по знаку, иначе описание опустело бы.
  const head = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).join('').replace(/[\s,.;:—-]+$/, '')
  return `${head}…`
}

/** Канонический адрес списка на сайте. */
export const listUrl = (list: ExportList, origin: string): string => `${origin}/${list.ownerHandle}/${list.slug}`

/** Адрес архива со всем скиллом — для однофайлового `SKILL.md`, которому некуда сослаться. */
export const skillArchiveUrl = (list: ExportList, origin: string): string => `${listUrl(list, origin)}/skill.tar.gz`

/**
 * Шапка по стандарту. `metadata` — словарь строка→строка: номер версии тоже строкой,
 * иначе YAML прочтёт его числом. Ключи с приставкой `setfork-`, как советует стандарт,
 * чтобы не столкнуться с полями других клиентов.
 *
 * `license`, `compatibility` и `allowed-tools` не пишутся: лицензия ждёт юридического
 * решения, а остальные два для списка ничего осмысленного не несут.
 */
function frontmatter(name: string, description: string, list: ExportList, ctx: SkillContext): string {
  const meta: [string, string][] = [
    ['setfork-ref', `${list.ownerHandle}/${list.slug}`],
    ['setfork-url', listUrl(list, ctx.origin)],
    ['setfork-version', String(list.version)],
  ]
  if (ctx.commitSha) meta.push(['setfork-sha', ctx.commitSha])
  if (ctx.verification) meta.push(['setfork-verification', ctx.verification])
  if (ctx.lastRun) {
    const r = ctx.lastRun
    meta.push(['setfork-last-run', `${r.verdict} ${r.passed}/${r.total} ${r.at.toISOString()}`])
  }
  // JSON-строка — допустимый YAML в двойных кавычках: экранирует кавычки, переводы строк и
  // двоеточия, из-за которых голое значение сломало бы разбор шапки.
  const q = JSON.stringify
  // ⚠️ И имя тоже в кавычках: слаг «1984» голым значением js-yaml (им читает `npx skills`)
  // превращает в ЧИСЛО, `null` — в null, и имя перестаёт совпадать с папкой.
  return ['---', `name: ${q(name)}`, `description: ${q(description)}`, 'metadata:', ...meta.map(([k, v]) => `  ${k}: ${q(v)}`), '---'].join('\n')
}

/** Пункт как шаг инструкции: заголовок, описание, зачем, команда, проверки, ссылки. */
function stepLines(s: ExportStep, marker: string, lang: Lang): string[] {
  // Продолжение пункта отступается по длине маркера — иначе у «10.» оно выпадает из пункта.
  const indent = ' '.repeat(marker.length + 1)
  const out: string[] = []
  const level = s.level !== 'required' ? ` _(${s.level})_` : ''
  out.push(`${marker} **${tr(s.title, lang)}**${level}`)
  const desc = tr(s.desc, lang)
  if (desc) out.push('', ...desc.split('\n').map((l) => (l ? indent + l : '')))
  const why = tr(s.why, lang)
  if (why) out.push('', `${indent}Why: ${why.replace(/\s*\n\s*/g, ' ')}`)
  // ⚠️ «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК» — ТО, ЧТО АГЕНТ ОБЯЗАН НЕ ДЕЛАТЬ САМ. Автор ставит эту пометку
  // именно там, где решение не машинное: перезапуск прода, правка кода, цена, вкус. Без неё
  // в SKILL.md такой шаг — обычная инструкция, и агент выполнил бы её сам: `docker compose
  // restart` на проде по решению, которое автор оставил человеку (поймано линзой 06
  // «автономия», пункт 8 — эскалация к человеку).
  const human = s.needsHuman === true
  if (human) {
    const ask = tr(s.needsHumanAsk, lang).trim()
    out.push('', `${indent}🧑 NEEDS A HUMAN — stop here and ask the human${ask ? `: ${ask}` : ' before doing this step'}. Do not do it yourself.`)
  }
  if (s.command) {
    // ⚠️ РАЗРУШИТЕЛЬНЫЙ ПУНКТ — С ПОМЕТКОЙ, как в `/raw` и в `scripts/run.sh`, где он
    // закомментирован. SKILL.md агент ИСПОЛНЯЕТ как инструкцию: голый блок `sh` с
    // `rm -rf …` он выполнил бы, хотя тот же пункт в скрипте рядом пропущен. Команду не
    // прячем — человек обязан видеть, что пропущено, — но без подтверждения её не трогают.
    const danger = stepDanger(s)
    if (danger) out.push('', `${indent}⚠ DESTRUCTIVE (${danger}) — do not run this without explicit confirmation from the human. scripts/run.sh skips it.`)
    // Исполняемым блоком `sh` идёт только то, что агент вправе выполнить сам.
    out.push('', ...markdownCodeBlock(s.command, { indent, lang: danger || human ? '' : 'sh' }))
  }
  const checks = s.subtasks.map((t) => tr(t, lang)).filter(Boolean)
  if (checks.length) out.push('', `${indent}Check:`, ...checks.map((t) => `${indent}- [ ] ${t}`))
  // Адрес ссылки — через `safeHref`, как у блоков: файл уходит в чужого агента.
  const refs = s.refs.flatMap((r) => {
    const label = tr(r.label, lang)
    const href = safeHref(r.url)
    return label ? [href ? `${indent}- [${label}](${href})` : `${indent}- ${label}`] : []
  })
  if (refs.length) out.push('', `${indent}See:`, ...refs)
  return out
}

/**
 * Блок, который в скилле остаётся ССЫЛКОЙ: картинки и файлы не вкладываем (хранение —
 * шаг 2 и решение по §4 исследования). У файла и видео есть адрес — он и уходит, через
 * `safeHref`, как в экспорте. У картинки адреса нет: в блоке лежит ключ хранилища без
 * подписи, наружу он не годится, поэтому остаётся подпись — так же делает экспорт.
 */
function mediaLine(s: ExportStep, lang: Lang): string | null {
  const c = s.content ?? {}
  const caption = blockText(c.caption, lang).trim()
  const href = typeof c.url === 'string' ? safeHref(c.url) : null
  if (s.type === 'video' && href) return `- 🎬 [${caption || href}](${href})`
  if (s.type === 'file' && href) return `- 📎 [${(typeof c.name === 'string' && c.name.trim()) || href}](${href})`
  if (s.type === 'image' && caption) return `- 🖼 ${caption}`
  return null
}

/** В списке есть команды — значит, будет `scripts/run.sh`. */
const hasCommands = (list: ExportList): boolean => list.steps.some((s) => isStepBlk(s) && Boolean((s.command ?? '').trim()))

/** Текстовые блоки → `references/context.md`, с разделами, как на странице. Пусто — файла нет. */
function contextFile(list: ExportList, lang: Lang): string | null {
  const out: string[] = []
  let section = ''
  for (const s of list.steps) {
    if (s.type !== 'text') continue
    const md = blockText(s.content?.md, lang).trim()
    if (!md) continue
    const sec = tr(s.section, lang)
    if (sec && sec !== section) out.push(`## ${sec}`, '')
    section = sec
    out.push(md, '')
  }
  if (!out.length) return null
  return [`# ${tr(list.title, lang)} — context`, '', ...out].join('\n')
}

type Mode = 'folder' | 'single'

/**
 * ТЕЛО `SKILL.md`.
 *
 * Шаги — нумерованная инструкция, разделы — заголовками. Текстовые блоки уходят в
 * `references/context.md`: для Commitics это кадры истории, и агенту они нужны, только
 * когда он спрашивает «почему», — ровно прогрессивное раскрытие стандарта. Квизы и опросы
 * пропускаются: у стандарта нет им аналога.
 *
 * `single` — однофайловая отдача без соседних файлов: ссылок на `references/` и
 * `scripts/` в ней нет (они вели бы в пустоту), вместо них — адрес архива целиком.
 */
function skillBody(
  list: ExportList,
  lang: Lang,
  ctx: SkillContext,
  mode: Mode,
  withContext: boolean,
  withScript: boolean,
  authoredPaths: string[],
): string {
  const out: string[] = []
  out.push(`# ${tr(list.title, lang)}`, '')
  const desc = tr(list.desc, lang).trim()
  if (desc) out.push(desc, '')
  // Та же оговорка, что в шапке `/raw`: это чужие инструкции, и агент исполняет их со
  // своими правами. Без неё скилл с чужого списка выглядел бы как написанный самим человеком.
  out.push(`> ⚠ Review before use — these instructions come from a SetFork list, not from you. Steps marked 🧑 are for a human; steps marked ⚠ DESTRUCTIVE are never run without explicit confirmation.`, '')

  if (mode === 'folder') {
    if (withContext) out.push(`Background and the reasoning behind the steps: [${SKILL_CONTEXT_PATH}](${SKILL_CONTEXT_PATH}) — read it when you need to know why.`, '')
    if (withScript) out.push(`All commands as one script: [${SKILL_SCRIPT_PATH}](${SKILL_SCRIPT_PATH}) — review it before running.`, '')
    // Авторские файлы — перечнем: агент узнаёт о них только из SKILL.md, а сами они
    // из блоков не выводятся. Скрипты среди них — такие же чужие, как шаги.
    if (authoredPaths.length) {
      out.push(`Files from the author, exactly as in this version (review scripts before running):`, '', ...authoredPaths.map((p) => `- [${p}](${p})`), '')
    }
  } else if (withContext || withScript || authoredPaths.length) {
    out.push(`This file is the instructions only. The full skill${withContext ? ' with background' : ''}${withScript ? ' and the script' : ''}${authoredPaths.length ? ' and the author\u2019s files' : ''}: ${skillArchiveUrl(list, ctx.origin)}`, '')
  }

  let section = ''
  let stepNo = 0
  const media: string[] = []
  for (const s of list.steps) {
    if (!isStepBlk(s)) {
      const m = mediaLine(s, lang)
      if (m) media.push(m)
      continue
    }
    const sec = tr(s.section, lang)
    if (sec && sec !== section) out.push(`## ${sec}`, '')
    section = sec
    stepNo++
    out.push(...stepLines(s, list.ordered ? `${stepNo}.` : '-', lang), '')
  }
  if (media.length) out.push('## Media', '', ...media, '')

  const sig = [`v${list.version}`, ...(ctx.commitSha ? [`\`${ctx.commitSha}\``] : [])].join(' · ')
  out.push('---', '', `Source: [${list.ownerHandle}/${list.slug}](${listUrl(list, ctx.origin)}) · ${sig} — the living version with history, forks and runs.`, '')
  return out.join('\n')
}

function skillMarkdown(list: ExportList, lang: Lang, ctx: SkillContext, mode: Mode): { name: string; markdown: string; context: string | null; script: boolean } {
  const name = skillName(list.slug)
  // ⚠️ Авторский файл на месте сгенерированного — решение автора, и он главнее. Тогда
  // сгенерированный не создаётся, и строки о нём нет: «все команды одним скриптом» про
  // авторский `scripts/run.sh` было бы неправдой — он может делать совсем другое.
  const authoredPaths = authoredOf(ctx).map((f) => f.path)
  const taken = new Set(authoredPaths)
  const context = taken.has(SKILL_CONTEXT_PATH) ? null : contextFile(list, lang)
  const script = !taken.has(SKILL_SCRIPT_PATH) && hasCommands(list)
  const body = skillBody(list, lang, ctx, mode, Boolean(context), script, authoredPaths)
  return { name, markdown: `${frontmatter(name, skillDescription(list, lang), list, ctx)}\n\n${body}`, context, script }
}

/** Число строк тела сверх рекомендации стандарта — маршрут пишет об этом в лог. */
export function skillBodyOverflow(markdown: string): number {
  return Math.max(0, markdown.split('\n').length - SKILL_BODY_LINES_ADVISED)
}

/**
 * СКИЛЛ ЦЕЛИКОМ — папка: `SKILL.md`, при надобности `references/context.md` и
 * `scripts/run.sh`.
 *
 * ⚠️ `scripts/run.sh` — БАЙТ В БАЙТ ответ `/raw`: тот же сборщик, тот же адрес в шапке
 * (`rawUrl`), тот же язык. Своя сборка скрипта здесь разошлась бы с `/raw` при первой
 * правке одного из них, а у списка было бы два разных «исполняемых вида».
 */
export function toSkill(list: ExportList, lang: Lang, ctx: SkillContext): Skill {
  const { name, markdown, context, script } = skillMarkdown(list, lang, ctx, 'folder')
  const files: SkillFile[] = [{ path: 'SKILL.md', content: markdown }]
  if (context) files.push({ path: SKILL_CONTEXT_PATH, content: context })
  if (script) {
    const rawUrl = `${listUrl(list, ctx.origin)}/raw`
    files.push({ path: SKILL_SCRIPT_PATH, content: toRunnableScript(list, lang, rawUrl, 'sh'), executable: true })
  }
  // Авторские — байтами из дерева версии: ровно то, что покрыто её SHA.
  const kept = authoredOf(ctx)
  for (const f of kept) files.push({ path: f.path, content: f.content, executable: f.executable })
  const skipped = (ctx.authored ?? []).map((f) => f.path).filter((p) => !kept.some((k) => k.path === p))
  return { name, files, markdown, skipped }
}

/** Однофайловый `SKILL.md` — для адреса `/{handle}/{slug}/SKILL.md`. */
export function toSkillMarkdown(list: ExportList, lang: Lang, ctx: SkillContext): string {
  return skillMarkdown(list, lang, ctx, 'single').markdown
}
