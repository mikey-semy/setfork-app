// Типы блоков списка (всё-блочная модель). Чистый модуль без server-only —
// используется и на сервере, и в редакторе. См. дизайн-док по блочному редактору.

import type { Lang } from '@/shared/i18n'

export const BLOCK_TYPES = ['step', 'text', 'image', 'poll', 'video', 'quiz', 'file', 'product'] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export const isBlockType = (t: string): t is BlockType => (BLOCK_TYPES as readonly string[]).includes(t)

/** Значение из БД/входа → тип блока; неизвестное трактуем шагом (как редактор). */
export const asBlockType = (v: unknown): BlockType => (typeof v === 'string' && isBlockType(v) ? v : 'step')

// Идентичность блока (isBlockUuid/newBlockId) переехала в shared/lib/block-id:
// её просит общий конвертер записи, а shared не может импортировать features.
import { isBlockUuid, newBlockId } from '@/shared/lib/block-id'
export { isBlockUuid, newBlockId }

// Две РАЗНЫЕ оси «исполнения» (уточнение от юзера):
//  1) Ручной прогон/использование — проходим список руками. Чек-действия — шаги;
//     text/image — контекст (показываются, отметки не требуют).
//  2) Скрипт (curl|bash) — исполняется ТОЛЬКО код. Шаг с командой → строка
//     скрипта; всё без кода → комментарий/echo (просто показать в консоли).

/** Чекается ли блок в ручном прогоне (действие, которое отмечают). */
export const isCheckable = (t: string): boolean => t === 'step'

/** Идёт ли блок исполняемой строкой в скрипт — зависит от НАЛИЧИЯ КОДА,
 *  а не только от типа. Остальное в скрипте — echo/комментарий. */
export const goesToScript = (t: string, command?: string): boolean => t === 'step' && !!command?.trim()

// Payload не-step блоков (в колонке steps.content). Step-блок payload не использует
// (его поля — в собственных колонках title/desc/command/…).
export interface TextBlockContent {
  md: string // markdown-врезка
}
export interface ImageBlockContent {
  ref?: string // storage_key картинки (как imageKey у шага)
  caption?: string
}
// Poll-блок: варианты (в git, версионируются) + голоса ВНЕ git (таблица poll_votes).
// Расширяемо под тесты/курсы: correct?, explanation, kind можно добавить позже.
export interface PollOption {
  id: string // стабильный id варианта — на него ссылаются голоса
  text: string
}
export interface PollBlockContent {
  bid?: string // стабильный id блока (как у всех не-step)
  question: string
  options: PollOption[]
  multi?: boolean // мульти-выбор (иначе один вариант)
  deadline?: string // ISO-дата; после неё голосование закрыто ('' / отсутствует — бессрочно)
}
// Video-блок: ссылка на видео (YouTube/Vimeo/прямой файл) + подпись.
export interface VideoBlockContent {
  bid?: string
  url: string
  caption?: string
}
// File-блок: вложение (PDF/архив/…) — ссылка + имя файла. Загрузка через
// uploadAttachmentFile (диск, 25МБ, белый список расширений). Отдаётся ссылкой на скачивание.
export interface FileBlockContent {
  bid?: string
  url: string
  name: string
}
// Product-домен (типы, PRODUCT_TIERS, productItems) живёт в @/core (как quiz):
// нужен рендеру (shared/ui/ProductBlock), редактору, /api/go и экспорту.
// Реэкспорт — чтобы блочный код импортировал всё про блоки из одного места.
export { PRODUCT_TIERS, productItems } from '@/core'
export type { ProductBlockContent, ProductItem, ProductTier } from '@/core'

// Quiz-домен (QuizBlockContent, стрип ответов, оценка) переехал в @/core —
// чистые функции нужны и рендеру, и server-оценке (quizzes), и MCP.

/** Разбор video-URL в БЕЗОПАСНУЮ встройку: iframe только для известных
 *  провайдеров (YouTube/Vimeo — не встраиваем произвольный src, это XSS-риск);
 *  прямой файл (.mp4/.webm/.ogg) → <video>; иначе — просто ссылка. */
export function parseVideoEmbed(url: string): { kind: 'youtube' | 'vimeo' | 'file' | 'link'; src: string } {
  const u = (url ?? '').trim()
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  if (yt) return { kind: 'youtube', src: `https://www.youtube.com/embed/${yt[1]}` }
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vm) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vm[1]}` }
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u)) return { kind: 'file', src: u }
  return { kind: 'link', src: u }
}

export const BLOCK_META: Record<BlockType, { icon: string; en: string; ru: string }> = {
  step: { icon: '👣', en: 'Step', ru: 'Шаг' },
  text: { icon: '📝', en: 'Text', ru: 'Текст' },
  image: { icon: '🖼️', en: 'Image', ru: 'Картинка' },
  poll: { icon: '📊', en: 'Poll', ru: 'Опрос' },
  video: { icon: '🎬', en: 'Video', ru: 'Видео' },
  quiz: { icon: '🎓', en: 'Quiz', ru: 'Тест' },
  file: { icon: '📎', en: 'File', ru: 'Файл' },
  product: { icon: '🛒', en: 'Products', ru: 'Товары' },
}

const CHAT_TITLE_MAX = 96

/** Первая ЧИТАЕМАЯ строка Markdown: заголовок/жирный абзац годится для шапки,
 *  а картинка, таблица и fenced-code — нет. Это не Markdown→plain конвертер:
 *  нам нужен короткий безопасный fallback, когда у text-блока нет метаданных. */
function markdownChatTitle(markdown: string): string {
  let fenced = false
  for (const raw of markdown.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      fenced = !fenced
      continue
    }
    if (fenced || !trimmed || /^( {4}|\t)/.test(raw) || /^\|.*\|$/.test(trimmed) || /^https?:\/\/\S+$/i.test(trimmed)) continue

    const plain = trimmed
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^(?:[-+*]|\d+[.)])\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[*_~`]+/g, '')
      .replace(/\\([\\`*_[\]{}()#+.!>\-])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
    if (!plain || /^[|:\-]+$/.test(plain)) continue
    return plain.length <= CHAT_TITLE_MAX ? plain : `${plain.slice(0, CHAT_TITLE_MAX - 1).trimEnd()}…`
  }
  return ''
}

/** Подпись блока для шапки чата раскопки: явный заголовок → секция урока →
 *  первая читаемая строка text-блока → локализованное имя типа. */
export const blockChatTitle = (type: BlockType, title: string, section: string, lang: Lang, markdown = ''): string =>
  title.trim() || section.trim() || (type === 'text' ? markdownChatTitle(markdown) : '') || (lang === 'ru' ? BLOCK_META[type].ru : BLOCK_META[type].en)

/** Стабильный id варианта опроса (на него ссылаются голоса). */
export const newOptionId = newBlockId

/** Дедлайн опроса → ms. Дата ('YYYY-MM-DD') трактуется как КОНЕЦ дня; полный
 *  datetime ('...T..') — как есть. null — нет/битый. Общий для рендера/votePoll. */
export function pollDeadlineMs(deadline?: string): number | null {
  if (!deadline) return null
  const t = new Date(deadline.includes('T') ? deadline : `${deadline}T23:59:59`).getTime()
  return Number.isNaN(t) ? null : t
}
