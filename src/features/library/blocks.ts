// Типы блоков списка (всё-блочная модель). Чистый модуль без server-only —
// используется и на сервере, и в редакторе. См. дизайн-док по блочному редактору.

export const BLOCK_TYPES = ['step', 'text', 'image', 'poll', 'video', 'quiz'] as const
export type BlockType = (typeof BLOCK_TYPES)[number]

export const isBlockType = (t: string): t is BlockType => (BLOCK_TYPES as readonly string[]).includes(t)

/** Стабильный id блока — живёт ВНУТРИ content (content.bid) у не-step блоков.
 *  Даёт идентичность для three-way merge: правка text/image — modify, а не add+remove.
 *  Хранение внутри content = ноль правок схемы/proto/Rust (content round-trip'ится
 *  опрозрачно). Генерится один раз при создании блока в редакторе. */
export function newBlockId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'b' + Math.random().toString(36).slice(2, 12)
}

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
// Quiz-блок (тест как на Stepik): вопрос + варианты с пометкой правильных.
// Проверка — на КЛИЕНТЕ (self-check): ответы лежат в content и версионируются
// в git вместе со списком (список всё равно форкается целиком — прятать ответы
// на сервере в v0 бессмысленно). Серверная оценка/прогресс — отдельный слайс (runs).
export interface QuizOption {
  id: string
  text: string
  correct?: boolean // помечен как верный (используется при проверке)
}
export interface QuizBlockContent {
  bid?: string
  question: string
  options: QuizOption[]
  multi?: boolean // несколько верных (иначе ровно один)
  explain?: string // пояснение, показывается после проверки
}

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
}

/** Стабильный id варианта опроса (на него ссылаются голоса). */
export const newOptionId = newBlockId

/** Дедлайн опроса → ms. Дата ('YYYY-MM-DD') трактуется как КОНЕЦ дня; полный
 *  datetime ('...T..') — как есть. null — нет/битый. Общий для рендера/votePoll. */
export function pollDeadlineMs(deadline?: string): number | null {
  if (!deadline) return null
  const t = new Date(deadline.includes('T') ? deadline : `${deadline}T23:59:59`).getTime()
  return Number.isNaN(t) ? null : t
}
