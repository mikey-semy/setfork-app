'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Footprints,
  GraduationCap,
  GripVertical,
  Heading,
  Image as ImageIcon,
  ImageUp,
  Loader2,
  Paperclip,
  Plus,
  Redo2,
  ShoppingCart,
  Sparkles,
  Text as TextIcon,
  Trash2,
  Undo2,
  Video as VideoIcon,
  X,
} from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Checkbox } from '@/shared/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Tooltip } from '@/shared/ui/Tooltip'
import { DatePicker } from '@/shared/ui/DatePicker'
import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { CodeEditor } from '@/shared/ui/CodeEditor'
import { emptyItem, emptyBlock, type EditorItem, type EditorPoll, type EditorProduct, type EditorQuiz } from './editor'
import { t } from '@/shared/i18n'
import { blankCount, type QuizKind } from '@/core'
import { classifyListKind, refineHint } from '@/shared/ai/list-kind'
import { BLOCK_TYPES, BLOCK_META, newOptionId, parseVideoEmbed, PRODUCT_TIERS, type BlockType, type ProductTier } from './blocks'
import { fetchLinkTitleAction, refineList } from './actions'
import { uploadWithProgress } from '@/shared/lib/xhr-upload'
import { UploadDropzone } from '@/shared/ui/UploadDropzone'

const BLOCK_ICON: Record<BlockType, typeof Footprints> = { step: Footprints, text: TextIcon, image: ImageIcon, poll: BarChart3, video: VideoIcon, quiz: GraduationCap, file: Paperclip, product: ShoppingCart }
const blockLabel = (t: BlockType, ru: boolean): string => (ru ? BLOCK_META[t].ru : BLOCK_META[t].en)

// Загрузка СВОИХ видеофайлов на наш хостинг выключена по умолчанию (нет ресурса
// обслуживать объёмы без дохода). Код загрузки на месте — включается флагом,
// когда появится хостинг (S3/Cloudflare Stream). Видео по ссылке работает всегда.
const VIDEO_UPLOAD_ENABLED = process.env.NEXT_PUBLIC_VIDEO_UPLOAD === '1'

// Кнопка внутри поля подписи ссылки: по URL тянет <title> страницы и подставляет
// его в название. Своё busy-состояние на строку. Неактивна без валидного URL.
function LinkTitleButton({ url, onLabel, ru }: { url: string; onLabel: (v: string) => void; ru: boolean }) {
  const [busy, setBusy] = useState(false)
  const ok = /^https?:\/\/\S+/i.test(url.trim())
  async function gen() {
    if (busy || !ok) return
    setBusy(true)
    const res = await fetchLinkTitleAction(url.trim())
    setBusy(false)
    if ('label' in res) onLabel(res.label)
  }
  return (
    <Tooltip label={ru ? 'Название из ссылки' : 'Get title from link'}>
      <button
        type="button"
        onClick={gen}
        disabled={busy || !ok}
        aria-label={ru ? 'Название из ссылки' : 'Get title from link'}
        className="grid h-6 w-6 place-items-center rounded text-ink-2 transition-colors hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-2"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
      </button>
    </Tooltip>
  )
}

const input =
  'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-hidden focus:border-border-strong'

export function ListEditor({
  name = 'items',
  initialItems,
  lang,
  aiRefine,
  ordered = true,
}: {
  name?: string
  initialItems: EditorItem[]
  lang: Lang
  /** Включает панель «Улучшить с ИИ»; передай title/desc/tags для контекста. */
  aiRefine?: { title: string; desc: string; tags: string[] }
  /** Упорядоченный список — нумерация; иначе набор (маркеры). */
  ordered?: boolean
}) {
  const ru = lang === 'ru'
  const first = initialItems.length ? initialItems : [emptyItem()]
  const [items, setItemsRaw] = useState<EditorItem[]>(first)
  const [imgProg, setImgProg] = useState<{ i: number; pct: number } | null>(null)
  const [dragI, setDragI] = useState<number | null>(null)
  const [overI, setOverI] = useState<number | null>(null)

  // Стабильные id пунктов (параллельно items) — нужны для ключей React и FLIP-анимации
  // перестановки. Начальные id детерминированы (без гидрационных расхождений).
  const nextUid = useRef(first.length)
  const newUid = () => 'r' + nextUid.current++
  const [uids, setUidsRaw] = useState<string[]>(() => first.map((_, i) => 'r' + i))

  // История для undo/redo. Снимок хранит и пункты, и их id (чтобы undo/redo и анимация
  // не путали, кто есть кто). Текстовые правки заменяют верхний снимок,
  // структурные (добавить/удалить/переместить/refine) — добавляют новый шаг.
  type Snap = { items: EditorItem[]; uids: string[] }
  const hist = useRef<Snap[]>([{ items: first, uids: first.map((_, i) => 'r' + i) }])
  const ptr = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const syncFlags = () => {
    setCanUndo(ptr.current > 0)
    setCanRedo(ptr.current < hist.current.length - 1)
  }
  const restore = (s: Snap) => {
    setItemsRaw(s.items)
    setUidsRaw(s.uids)
  }

  // Текстовая правка: порядок/состав не меняются — id те же, обновляем верхний снимок.
  const setText = (next: EditorItem[]) => {
    hist.current[ptr.current] = { items: next, uids }
    setItemsRaw(next)
  }
  // Структурная правка: новый шаг истории (пункты + их id).
  const commit = (next: EditorItem[], nextUids: string[]) => {
    hist.current = hist.current.slice(0, ptr.current + 1)
    hist.current.push({ items: next, uids: nextUids })
    ptr.current = hist.current.length - 1
    setItemsRaw(next)
    setUidsRaw(nextUids)
    syncFlags()
  }
  const undo = () => {
    if (ptr.current > 0) {
      ptr.current -= 1
      restore(hist.current[ptr.current])
      syncFlags()
    }
  }
  const redo = () => {
    if (ptr.current < hist.current.length - 1) {
      ptr.current += 1
      restore(hist.current[ptr.current])
      syncFlags()
    }
  }

  const patch = (i: number, p: Partial<EditorItem>) =>
    setText(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)))

  // FLIP-анимация перестановки: карточка плавно «доезжает» до новой позиции,
  // а не перепрыгивает. Меряем позиции до/после и анимируем дельту (WAAPI).
  const listRef = useRef<HTMLDivElement>(null)
  const prevRects = useRef<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-uid]')
    if (!nodes) return
    const now = new Map<string, number>()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const firstRun = prevRects.current.size === 0 // начальный маунт — блоки не анимируем
    nodes.forEach((node) => {
      const uid = node.dataset.uid!
      const top = node.getBoundingClientRect().top
      now.set(uid, top)
      const prev = prevRects.current.get(uid)
      if (reduce) return
      if (prev == null) {
        // Новый блок (добавлен после маунта) — плавное появление, а не рывок.
        if (!firstRun) {
          node.animate(
            [{ opacity: 0, transform: 'translateY(-6px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
            { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
          )
        }
      } else if (prev !== top) {
        // Существующий блок сдвинулся — FLIP «доезд» до новой позиции.
        node.animate(
          [{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        )
      }
    })
    prevRects.current = now
  }, [uids])

  const [instruction, setInstruction] = useState('')
  const [refining, setRefining] = useState(false)
  const [refineErr, setRefineErr] = useState('')

  async function runRefine() {
    const ins = instruction.trim()
    if (!ins || refining) return
    setRefining(true)
    setRefineErr('')
    const res = await refineList({ items, title: aiRefine?.title ?? '', desc: aiRefine?.desc ?? '', tags: aiRefine?.tags ?? [], instruction: ins })
    setRefining(false)
    if ('error' in res) {
      setRefineErr(
        res.error === 'ratelimited'
          ? ru ? 'Слишком часто — подожди.' : 'Too many requests — wait a bit.'
          : res.error === 'ai_quota'
            ? ru ? 'Исчерпан месячный лимит на правки.' : 'Monthly refine limit reached.'
            : ru ? 'Не удалось. Переформулируй.' : 'Failed. Try rephrasing.',
      )
      return
    }
    if (res.items.length) {
      commit(res.items, res.items.map(() => newUid()))
      setInstruction('')
    }
  }

  // Загрузки идут через XHR (shared/lib/xhr-upload) ради РЕАЛЬНОГО прогресса —
  // заливка dropzone слева-направо вместо неопределённого спиннера.
  async function uploadFor(i: number, file: File) {
    setImgProg({ i, pct: 0 })
    try {
      const res = await uploadWithProgress('step-image', file, (pct) => setImgProg({ i, pct }))
      patch(i, { imageKey: res.key, imagePreview: res.url })
    } catch (e) {
      alert(e instanceof Error ? e.message : ru ? 'Не удалось загрузить.' : 'Upload failed.')
    } finally {
      setImgProg(null)
    }
  }
  const [vidProg, setVidProg] = useState<{ i: number; pct: number } | null>(null)
  async function uploadVideoFor(i: number, file: File) {
    setVidProg({ i, pct: 0 })
    try {
      const res = await uploadWithProgress('step-video', file, (pct) => setVidProg({ i, pct }))
      patch(i, { videoUrl: res.url })
    } catch (e) {
      alert(e instanceof Error ? e.message : ru ? 'Не удалось загрузить.' : 'Upload failed.')
    } finally {
      setVidProg(null)
    }
  }
  const [fileProg, setFileProg] = useState<{ i: number; pct: number } | null>(null)
  async function uploadFileFor(i: number, file: File) {
    setFileProg({ i, pct: 0 })
    try {
      const res = await uploadWithProgress('step-file', file, (pct) => setFileProg({ i, pct }))
      patch(i, { fileUrl: res.url, fileName: res.name })
    } catch (e) {
      alert(e instanceof Error ? e.message : ru ? 'Не удалось загрузить.' : 'Upload failed.')
    } finally {
      setFileProg(null)
    }
  }
  // Вставка блока на позицию index (0..len). index === len → в конец.
  const insertAt = (index: number, type: BlockType) => {
    const at = Math.max(0, Math.min(index, items.length))
    const nextI = [...items.slice(0, at), emptyBlock(type), ...items.slice(at)]
    const nextU = [...uids.slice(0, at), newUid(), ...uids.slice(at)]
    commit(nextI, nextU)
  }
  const removeItem = (i: number) => {
    if (items.length > 1) commit(items.filter((_, idx) => idx !== i), uids.filter((_, idx) => idx !== i))
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const nextI = [...items]
    const nextU = [...uids]
    ;[nextI[i], nextI[j]] = [nextI[j], nextI[i]]
    ;[nextU[i], nextU[j]] = [nextU[j], nextU[i]]
    commit(nextI, nextU)
  }
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    const nextI = [...items]
    const nextU = [...uids]
    const [movedI] = nextI.splice(from, 1)
    const [movedU] = nextU.splice(from, 1)
    nextI.splice(to, 0, movedI)
    nextU.splice(to, 0, movedU)
    commit(nextI, nextU)
  }
  const moveToEdge = (i: number, edge: 'top' | 'bottom') => reorder(i, edge === 'top' ? 0 : items.length - 1)

  // Клавиши: Ctrl/⌘+Z / +Shift+Z / +Y — undo/redo (не в полях, там нативно);
  // Alt+↑/↓ — переместить пункт под фокусом.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement
    const inField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      if (inField) return
      e.preventDefault()
      e.shiftKey ? redo() : undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      if (inField) return
      e.preventDefault()
      redo()
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const card = el.closest('[data-i]') as HTMLElement | null
      if (!card) return
      e.preventDefault()
      move(Number(card.dataset.i), e.key === 'ArrowUp' ? -1 : 1)
    }
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <input type="hidden" name={name} value={JSON.stringify(items)} />

      {/* Тулбар: undo/redo + подсказка */}
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Tooltip label={ru ? 'Отменить (Ctrl+Z)' : 'Undo (Ctrl+Z)'}>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40 enabled:hover:border-border-strong enabled:text-ink-2"
          >
            <Undo2 size={13} /> {ru ? 'Отменить' : 'Undo'}
          </button>
        </Tooltip>
        <Tooltip label={ru ? 'Повторить (Ctrl+Shift+Z)' : 'Redo (Ctrl+Shift+Z)'}>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40 enabled:hover:border-border-strong enabled:text-ink-2"
          >
            <Redo2 size={13} /> {ru ? 'Повторить' : 'Redo'}
          </button>
        </Tooltip>
        <span className="ml-1 hidden sm:inline">{ru ? 'перетаскивай ⠿, Alt+↑/↓ — двигать' : 'drag ⠿, Alt+↑/↓ to move'}</span>
      </div>

      {aiRefine && (
        <div className="rounded-lg border border-(--accent) bg-(--accent-soft) p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-accent">
            <Sparkles size={14} /> {ru ? 'Улучшить' : 'Improve'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Плейсхолдер — готовая фраза ПО ТИПУ списка (тот же refineHint, что в чате
                генерации): тип выводится классификатором из заголовка бесплатно, без
                LLM-вызова. Хардкод «про TLS» на рецепте выглядел нелепо (фидбек владельца). */}
            <input
              className={`${input} min-w-[240px] flex-1`}
              placeholder={refineHint(classifyListKind(aiRefine.title), ru)}
              value={instruction}
              disabled={refining}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runRefine()
                }
              }}
            />
            <button
              type="button"
              onClick={() => void runRefine()}
              disabled={refining || !instruction.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg disabled:opacity-50"
            >
              {refining ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {refining ? (ru ? 'Правлю…' : 'Refining…') : ru ? 'Применить' : 'Apply'}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-2">
            {ru
              ? 'Пункты будут переписаны. Скриншоты и ссылки при этом сбрасываются.'
              : 'The items get rewritten. Screenshots and links are reset.'}
          </p>
          {refineErr && <p className="mt-1 text-[12px] text-danger">{refineErr}</p>}
        </div>
      )}

      <div ref={listRef} className="flex flex-col gap-3">
      {items.map((it, i) => (
        <div
          key={uids[i]}
          data-i={i}
          data-uid={uids[i]}
          onDragOver={(e) => {
            if (dragI !== null) {
              e.preventDefault()
              if (overI !== i) setOverI(i)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragI !== null) reorder(dragI, i)
            setDragI(null)
            setOverI(null)
          }}
          className={`rounded-lg border bg-surface p-4 transition-colors ${
            overI === i && dragI !== null ? 'border-accent' : 'border-border'
          } ${dragI === i ? 'opacity-50' : ''}`}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <Tooltip label={ru ? 'Перетащить' : 'Drag to reorder'}>
              <span
                draggable
                onDragStart={() => setDragI(i)}
                onDragEnd={() => {
                  setDragI(null)
                  setOverI(null)
                }}
                className="cursor-grab rounded p-0.5 text-muted hover:text-ink active:cursor-grabbing"
              >
                <GripVertical size={15} />
              </span>
            </Tooltip>
            {it.type === 'step' ? (
              <span className="font-mono text-[12px] text-muted">
                {ordered ? `${ru ? 'Пункт' : 'Item'} ${items.slice(0, i).filter((x) => x.type === 'step').length + 1}` : '•'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted">
                {(() => {
                  const Icon = BLOCK_ICON[it.type]
                  return <Icon size={13} />
                })()}
                {blockLabel(it.type, ru)}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Tooltip label={ru ? 'В начало' : 'Move to top'}>
                <button type="button" onClick={() => moveToEdge(i, 'top')} disabled={i === 0} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
                  <ChevronsUp size={15} />
                </button>
              </Tooltip>
              <Tooltip label={ru ? 'Выше' : 'Move up'}>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
                  <ChevronUp size={15} />
                </button>
              </Tooltip>
              <Tooltip label={ru ? 'Ниже' : 'Move down'}>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
                  <ChevronDown size={15} />
                </button>
              </Tooltip>
              <Tooltip label={ru ? 'В конец' : 'Move to bottom'}>
                <button type="button" onClick={() => moveToEdge(i, 'bottom')} disabled={i === items.length - 1} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30 disabled:hover:text-muted">
                  <ChevronsDown size={15} />
                </button>
              </Tooltip>
              <Tooltip label={ru ? 'Удалить' : 'Remove'}>
                <button type="button" onClick={() => removeItem(i)} className="rounded p-1 text-muted hover:text-danger">
                  <Trash2 size={15} />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Урок/секция: у ЛЮБОГО блока — если задан, начинает новую группу
              (урок курса), объединяющую блоки ниже до следующего заголовка. */}
          <div className={`mb-2 flex items-center gap-1.5 ${it.section.trim() ? 'text-accent' : 'text-muted'}`}>
            <Heading size={13} className="shrink-0" />
            <BubbleTextEditor
              value={it.section}
              onChange={(v) => patch(i, { section: v })}
              singleLine
              bare
              className="flex-1"
              textareaClassName="text-[12.5px] font-semibold placeholder:font-normal placeholder:text-muted"
              lang={ru ? 'ru' : 'en'}
              ariaLabel={ru ? `Урок/секция блока ${i + 1}` : `Block ${i + 1} lesson/section`}
              placeholder={ru ? 'Урок/секция (необязательно) — группирует блоки ниже' : 'Lesson/section (optional) — groups the blocks below'}
            />
          </div>

          {it.type === 'step' && (
          <div className="flex flex-col gap-2">
            <BubbleTextEditor
              value={it.title}
              onChange={(v) => patch(i, { title: v })}
              singleLine
              lang={ru ? 'ru' : 'en'}
              ariaLabel={ru ? `Заголовок пункта ${i + 1}` : `Item ${i + 1} title`}
              placeholder={ru ? 'Заголовок пункта' : 'Item title'}
            />
            {/* Описание пункта — Markdown со всплывающей панелью форматирования
                (выдели текст → мини-тулбар). Картинки/файлы — отдельными блоками. */}
            <BubbleTextEditor
              value={it.desc}
              onChange={(v) => patch(i, { desc: v })}
              rows={3}
              lang={ru ? 'ru' : 'en'}
              ariaLabel={ru ? `Описание пункта ${i + 1}` : `Item ${i + 1} description`}
              placeholder={ru ? 'Описание (Markdown, необязательно)' : 'Description (Markdown, optional)'}
            />
            <CodeEditor
              value={it.command || ''}
              onChange={(v) => patch(i, { command: v })}
              ariaLabel={ru ? `Команда пункта ${i + 1}` : `Item ${i + 1} command`}
              placeholder={ru ? 'Команда или код (необязательно)' : 'Command or code (optional)'}
            />

            {/* Уровень + «зачем» */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] text-muted">{ru ? 'Уровень' : 'Level'}:</span>
              {(['required', 'recommended', 'optional'] as const).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => patch(i, { level: lv })}
                  className={`rounded px-2 py-0.5 text-[11.5px] ${
                    it.level === lv ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-2 hover:text-ink'
                  }`}
                >
                  {lv === 'required'
                    ? ru ? 'Обязательно' : 'Required'
                    : lv === 'recommended'
                      ? ru ? 'Рекомендуется' : 'Recommended'
                      : ru ? 'Опционально' : 'Optional'}
                </button>
              ))}
            </div>
            <BubbleTextEditor
              value={it.why}
              onChange={(v) => patch(i, { why: v })}
              singleLine
              lang={ru ? 'ru' : 'en'}
              ariaLabel={ru ? 'Зачем этот шаг' : 'Why this step matters'}
              placeholder={ru ? 'Зачем этот шаг (необязательно)' : 'Why this step matters (optional)'}
            />

            {/* Подпункты */}
            {it.subtasks.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {it.subtasks.map((s, si) => (
                  <div key={si} className="flex items-center gap-2">
                    <span className="text-muted">–</span>
                    <BubbleTextEditor
                      value={s}
                      onChange={(v) => patch(i, { subtasks: it.subtasks.map((x, xi) => (xi === si ? v : x)) })}
                      singleLine
                      className="flex-1"
                      lang={ru ? 'ru' : 'en'}
                      ariaLabel={ru ? `Подпункт ${si + 1}` : `Sub-item ${si + 1}`}
                      placeholder={ru ? 'Подпункт' : 'Sub-item'}
                    />
                    <button
                      type="button"
                      onClick={() => patch(i, { subtasks: it.subtasks.filter((_, xi) => xi !== si) })}
                      className="text-muted hover:text-danger"
                      aria-label={ru ? 'Удалить подпункт' : 'Remove sub-item'}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Ссылки */}
            {it.refs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {it.refs.map((r, ri) => (
                  <div key={ri} className="flex items-center gap-2">
                    <BubbleTextEditor
                      value={r.label}
                      onChange={(v) => patch(i, { refs: it.refs.map((x, xi) => (xi === ri ? { ...x, label: v } : x)) })}
                      singleLine
                      className="w-[200px] shrink-0"
                      textareaClassName="leading-normal"
                      lang={ru ? 'ru' : 'en'}
                      ariaLabel={ru ? 'Название ссылки' : 'Link label'}
                      placeholder={ru ? 'Название ссылки' : 'Link label'}
                      trailing={
                        <LinkTitleButton
                          url={r.url}
                          ru={ru}
                          onLabel={(v) => patch(i, { refs: it.refs.map((x, xi) => (xi === ri ? { ...x, label: v } : x)) })}
                        />
                      }
                    />
                    <input
                      className={`${input} font-mono leading-normal`}
                      aria-label={ru ? 'URL ссылки' : 'Link URL'}
                      placeholder="https://…"
                      value={r.url}
                      onChange={(e) =>
                        patch(i, { refs: it.refs.map((x, xi) => (xi === ri ? { ...x, url: e.target.value } : x)) })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => patch(i, { refs: it.refs.filter((_, xi) => xi !== ri) })}
                      className="text-muted hover:text-danger"
                      aria-label={ru ? 'Удалить ссылку' : 'Remove link'}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Скриншот */}
            {it.imagePreview ? (
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.imagePreview} alt="" className="max-h-[160px] rounded-md border border-border" />
                <button
                  type="button"
                  onClick={() => patch(i, { imageKey: '', imagePreview: '' })}
                  aria-label="remove image"
                  className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <UploadDropzone progress={imgProg?.i === i ? imgProg.pct : null} accept="image/png,image/jpeg,image/webp,image/gif" onFile={(f) => uploadFor(i, f)} idle={<><ImageUp size={14} className="shrink-0" /> {ru ? 'Скриншот: перетащите или нажмите' : 'Screenshot: drag or click'}</>} ru={ru} />
            )}

            <div className="flex flex-wrap gap-3 pt-1 text-[12px]">
              <button
                type="button"
                onClick={() => patch(i, { subtasks: [...it.subtasks, ''] })}
                className="text-accent hover:underline"
              >
                + {ru ? 'подпункт' : 'sub-item'}
              </button>
              <button
                type="button"
                onClick={() => patch(i, { refs: [...it.refs, { label: '', url: '' }] })}
                className="text-accent hover:underline"
              >
                + {ru ? 'ссылку' : 'link'}
              </button>
            </div>
          </div>
          )}

          {/* Text-блок: богатый markdown-редактор (как в комментариях). */}
          {it.type === 'text' && <TextBlockBody value={it.text} onChange={(v) => patch(i, { text: v })} ru={ru} />}

          {/* Image-блок: картинка + подпись. */}
          {it.type === 'image' && (
            <div className="flex flex-col gap-2">
              {it.imagePreview ? (
                <div className="relative w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.imagePreview} alt="" className="max-h-[320px] rounded-md border border-border" />
                  <button
                    type="button"
                    onClick={() => patch(i, { imageKey: '', imagePreview: '' })}
                    aria-label="remove image"
                    className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <UploadDropzone progress={imgProg?.i === i ? imgProg.pct : null} accept="image/png,image/jpeg,image/webp,image/gif" onFile={(f) => uploadFor(i, f)} idle={<><ImageUp size={14} className="shrink-0" /> {ru ? 'Скриншот: перетащите или нажмите' : 'Screenshot: drag or click'}</>} ru={ru} />
              )}
              <BubbleTextEditor
                value={it.caption}
                onChange={(v) => patch(i, { caption: v })}
                singleLine
                lang={ru ? 'ru' : 'en'}
                ariaLabel={ru ? 'Подпись картинки' : 'Image caption'}
                placeholder={ru ? 'Подпись (необязательно)' : 'Caption (optional)'}
              />
            </div>
          )}

          {/* Poll-блок: вопрос + варианты + мульти + дедлайн. */}
          {it.type === 'poll' && <PollBlockBody poll={it.poll} onChange={(poll) => patch(i, { poll })} ru={ru} />}

          {/* Quiz-блок: вопрос + варианты с пометкой верных + пояснение. */}
          {it.type === 'quiz' && <QuizBlockBody quiz={it.quiz} onChange={(quiz) => patch(i, { quiz })} ru={ru} />}

          {/* Video-блок: ссылка (YouTube/Vimeo/mp4) + подпись; хинт распознанного типа. */}
          {it.type === 'video' && (
            <div className="flex flex-col gap-2">
              <input
                className={input}
                aria-label={ru ? 'Ссылка на видео' : 'Video URL'}
                placeholder={ru ? 'Ссылка: YouTube / Vimeo / .mp4' : 'URL: YouTube / Vimeo / .mp4'}
                value={it.videoUrl}
                onChange={(e) => patch(i, { videoUrl: e.target.value })}
              />
              {VIDEO_UPLOAD_ENABLED && (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <span className="h-px flex-1 bg-border" />
                    {ru ? 'или' : 'or'}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <UploadDropzone progress={vidProg?.i === i ? vidProg.pct : null} accept="video/mp4,video/webm,video/ogg" onFile={(f) => uploadVideoFor(i, f)} idle={<><VideoIcon size={14} className="shrink-0" /> {ru ? 'Свой файл: перетащите или нажмите (MP4/WEBM, до 50 МБ)' : 'Own file: drag or click (MP4/WEBM, up to 50 MB)'}</>} ru={ru} />
                </>
              )}
              <BubbleTextEditor
                value={it.caption}
                onChange={(v) => patch(i, { caption: v })}
                singleLine
                lang={ru ? 'ru' : 'en'}
                ariaLabel={ru ? 'Подпись видео' : 'Video caption'}
                placeholder={ru ? 'Подпись (необязательно)' : 'Caption (optional)'}
              />
              {it.videoUrl.trim() &&
                (() => {
                  const kind = parseVideoEmbed(it.videoUrl).kind
                  return (
                    <span className={`text-[11.5px] ${kind === 'link' ? 'text-warn' : 'text-muted'}`}>
                      {kind === 'youtube' && '▶ YouTube'}
                      {kind === 'vimeo' && '▶ Vimeo'}
                      {kind === 'file' && (ru ? '▶ Видеофайл' : '▶ Video file')}
                      {kind === 'link' && (ru ? '⚠ Не распознано — будет показано ссылкой' : '⚠ Not recognized — shown as a link')}
                    </span>
                  )
                })()}
            </div>
          )}

          {/* File-блок: вложение (PDF/архив/…) — загрузка или ссылка на скачивание. */}
          {it.type === 'file' && (
            <div className="flex flex-col gap-2">
              {it.fileUrl ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px]">
                  <Paperclip size={14} className="shrink-0 text-muted" />
                  <a href={it.fileUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-accent hover:underline">
                    {it.fileName || it.fileUrl}
                  </a>
                  <button type="button" onClick={() => patch(i, { fileUrl: '', fileName: '' })} className="text-muted hover:text-danger" aria-label={ru ? 'Удалить' : 'Remove'}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <UploadDropzone progress={fileProg?.i === i ? fileProg.pct : null} onFile={(f) => uploadFileFor(i, f)} idle={<><Paperclip size={14} className="shrink-0" /> {ru ? 'Файл: перетащите или нажмите (PDF/док/архив, до 25 МБ)' : 'File: drag or click (PDF/doc/archive, up to 25 MB)'}</>} ru={ru} />
              )}
            </div>
          )}

          {/* Product-блок: подборка товаров (имя+ссылка+ярус+пометка) + заголовок. */}
          {it.type === 'product' && (
            <ProductBlockBody
              products={it.products}
              caption={it.caption}
              onProducts={(products) => patch(i, { products })}
              onCaption={(caption) => patch(i, { caption })}
              ru={ru}
            />
          )}

          {/* Инсертер между блоками: вставить после текущего блока. После ПОСЛЕДНЕГО
              не рисуем — конец списка покрывает главный инсертер ниже (без дубля).
              «Повторить предыдущий» = тип блока, ПОД которым стоит инсертер. */}
          {i < items.length - 1 && (
            <BlockInserter onInsert={(type) => insertAt(i + 1, type)} repeatType={it.type} ru={ru} between />
          )}
        </div>
      ))}
      </div>

      {/* Главный инсертер — добавить блок в конец списка. Повтор = тип последнего блока. */}
      <div className="flex justify-center pt-1">
        <BlockInserter onInsert={(type) => insertAt(items.length, type)} repeatType={items[items.length - 1]?.type ?? 'step'} ru={ru} />
      </div>
    </div>
  )
}

/** Text-блок: авто-растущая textarea. Пустое поле + ввод «/» открывает меню
 *  смены типа блока (быстрый /-командой заменить пустой text на step/image). */
/** Product-блок: заголовок подборки + строки товаров (имя, ссылка, ярус, пометка). */
function ProductBlockBody({
  products,
  caption,
  onProducts,
  onCaption,
  ru,
}: {
  products: EditorProduct[]
  caption: string
  onProducts: (p: EditorProduct[]) => void
  onCaption: (c: string) => void
  ru: boolean
}) {
  const lang = ru ? ('ru' as const) : ('en' as const)
  const patchRow = (i: number, p: Partial<EditorProduct>) => onProducts(products.map((x, xi) => (xi === i ? { ...x, ...p } : x)))
  const tierLabel = (tr: ProductTier): string =>
    tr === 'budget' ? t('productTierBudget', lang) : tr === 'mid' ? t('productTierMid', lang) : t('productTierPremium', lang)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <input
        className={input}
        aria-label={t('productCaptionPh', lang)}
        placeholder={t('productCaptionPh', lang)}
        value={caption}
        onChange={(e) => onCaption(e.target.value)}
      />
      {products.map((p, pi) => (
        <div key={pi} className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2 sm:flex-row sm:items-center">
          <input
            className={`${input} sm:max-w-[180px]`}
            aria-label={t('productNamePh', lang)}
            placeholder={t('productNamePh', lang)}
            value={p.name}
            onChange={(e) => patchRow(pi, { name: e.target.value })}
          />
          <input
            className={`${input} font-mono`}
            aria-label="URL"
            placeholder="https://…"
            value={p.url}
            onChange={(e) => patchRow(pi, { url: e.target.value })}
          />
          <Select
            value={p.tier || '__none__'}
            onValueChange={(v) => patchRow(pi, { tier: (v === '__none__' ? '' : v) as EditorProduct['tier'] })}
          >
            <SelectTrigger className="sm:max-w-[130px]" aria-label={t('productTierNone', lang)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t('productTierNone', lang)}</SelectItem>
              {PRODUCT_TIERS.map((tr) => (
                <SelectItem key={tr} value={tr}>
                  {tierLabel(tr)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            className={input}
            aria-label={t('productNotePh', lang)}
            placeholder={t('productNotePh', lang)}
            value={p.note}
            onChange={(e) => patchRow(pi, { note: e.target.value })}
          />
          <button
            type="button"
            onClick={() => onProducts(products.filter((_, xi) => xi !== pi))}
            className="grid h-7 w-7 shrink-0 place-items-center self-end rounded text-muted hover:text-danger sm:self-auto"
            aria-label={t('productRemove', lang)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="text-[12.5px]">
        <button type="button" onClick={() => onProducts([...products, { name: '', url: '', tier: '', note: '' }])} className="text-accent hover:underline">
          + {t('productAdd', lang)}
        </button>
      </div>
    </div>
  )
}

function PollBlockBody({ poll, onChange, ru }: { poll: EditorPoll; onChange: (p: EditorPoll) => void; ru: boolean }) {
  const set = (p: Partial<EditorPoll>) => onChange({ ...poll, ...p })
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <BubbleTextEditor
        value={poll.question}
        onChange={(v) => set({ question: v })}
        singleLine
        lang={ru ? 'ru' : 'en'}
        ariaLabel={ru ? 'Вопрос опроса' : 'Poll question'}
        placeholder={ru ? 'Вопрос опроса' : 'Poll question'}
      />
      <div className="flex flex-col gap-1.5">
        {poll.options.map((o, oi) => (
          <div key={o.id} className="flex items-center gap-2">
            <span className="w-4 text-right text-[11px] text-muted">{oi + 1}</span>
            <BubbleTextEditor
              value={o.text}
              onChange={(v) => set({ options: poll.options.map((x, xi) => (xi === oi ? { ...x, text: v } : x)) })}
              singleLine
              className="flex-1"
              lang={ru ? 'ru' : 'en'}
              ariaLabel={ru ? `Вариант ${oi + 1}` : `Option ${oi + 1}`}
              placeholder={ru ? `Вариант ${oi + 1}` : `Option ${oi + 1}`}
            />
            <button
              type="button"
              onClick={() => set({ options: poll.options.filter((_, xi) => xi !== oi) })}
              disabled={poll.options.length <= 2}
              className="text-muted hover:text-danger disabled:opacity-30"
              aria-label={ru ? 'Удалить вариант' : 'Remove option'}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[12px]">
        <button type="button" onClick={() => set({ options: [...poll.options, { id: newOptionId(), text: '' }] })} className="text-accent hover:underline">
          + {ru ? 'вариант' : 'option'}
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
          <Checkbox checked={poll.multi} onChange={(e) => set({ multi: e.target.checked })} />
          {ru ? 'Мультивыбор' : 'Multi-select'}
        </label>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          {ru ? 'Дедлайн' : 'Deadline'}:
          <DatePicker value={poll.deadline} onChange={(v) => set({ deadline: v })} lang={ru ? 'ru' : 'en'} />
        </span>
      </div>
    </div>
  )
}

/** Quiz-блок в редакторе: вопрос + варианты с пометкой «верный» + пояснение.
 *  При одиночном режиме пометка «верный» эксклюзивна (снимает у остальных). */
const QUIZ_KIND_OPTS: { k: QuizKind; ru: string; en: string }[] = [
  { k: 'choice', ru: 'Выбор', en: 'Choice' },
  { k: 'text', ru: 'Текст', en: 'Text' },
  { k: 'number', ru: 'Число', en: 'Number' },
  { k: 'blank', ru: 'Пропуски', en: 'Blanks' },
  { k: 'match', ru: 'Пары', en: 'Match' },
  { k: 'sort', ru: 'Порядок', en: 'Sort' },
  { k: 'code', ru: 'Код', en: 'Code' },
]

function QuizBlockBody({ quiz, onChange, ru }: { quiz: EditorQuiz; onChange: (q: EditorQuiz) => void; ru: boolean }) {
  const set = (q: Partial<EditorQuiz>) => onChange({ ...quiz, ...q })
  const toggleCorrect = (oi: number) =>
    set({
      options: quiz.options.map((x, xi) =>
        xi === oi ? { ...x, correct: !x.correct } : quiz.multi ? x : { ...x, correct: false },
      ),
    })
  const accept = quiz.accept.length ? quiz.accept : ['']
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      {/* Тип теста */}
      <div className="flex items-center gap-1 self-start rounded-md border border-border bg-surface p-0.5 text-[12px]">
        {QUIZ_KIND_OPTS.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => set({ kind: o.k })}
            className={`rounded px-2.5 py-1 ${quiz.kind === o.k ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {ru ? o.ru : o.en}
          </button>
        ))}
      </div>

      <BubbleTextEditor
        value={quiz.question}
        onChange={(v) => set({ question: v })}
        singleLine
        lang={ru ? 'ru' : 'en'}
        ariaLabel={ru ? 'Вопрос теста' : 'Quiz question'}
        placeholder={ru ? 'Вопрос теста' : 'Quiz question'}
      />

      {quiz.kind === 'choice' && (
        <>
          <div className="flex flex-col gap-1.5">
            {quiz.options.map((o, oi) => (
              <div key={o.id} className="flex items-center gap-2">
                <Tooltip label={o.correct ? (ru ? 'Верный ответ' : 'Correct answer') : ru ? 'Отметить верным' : 'Mark correct'}>
                  <button
                    type="button"
                    onClick={() => toggleCorrect(oi)}
                    aria-pressed={o.correct}
                    aria-label={ru ? 'Отметить верным' : 'Mark correct'}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                      o.correct ? 'border-ok bg-ok/15 text-ok' : 'border-border-strong text-transparent hover:border-ok'
                    }`}
                  >
                    <Check size={13} />
                  </button>
                </Tooltip>
                <BubbleTextEditor
                  value={o.text}
                  onChange={(v) => set({ options: quiz.options.map((x, xi) => (xi === oi ? { ...x, text: v } : x)) })}
                  singleLine
                  className="flex-1"
                  lang={ru ? 'ru' : 'en'}
                  ariaLabel={ru ? `Вариант ${oi + 1}` : `Option ${oi + 1}`}
                  placeholder={ru ? `Вариант ${oi + 1}` : `Option ${oi + 1}`}
                />
                <button
                  type="button"
                  onClick={() => set({ options: quiz.options.filter((_, xi) => xi !== oi) })}
                  disabled={quiz.options.length <= 2}
                  className="text-muted hover:text-danger disabled:opacity-30"
                  aria-label={ru ? 'Удалить вариант' : 'Remove option'}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[12px]">
            <button
              type="button"
              onClick={() => set({ options: [...quiz.options, { id: newOptionId(), text: '', correct: false }] })}
              className="text-accent hover:underline"
            >
              + {ru ? 'вариант' : 'option'}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
              <Checkbox checked={quiz.multi} onChange={(e) => set({ multi: e.target.checked })} />
              {ru ? 'Несколько верных' : 'Multiple correct'}
            </label>
          </div>
        </>
      )}

      {(quiz.kind === 'text' || quiz.kind === 'code') && (
        <>
          {quiz.kind === 'code' && <span className="text-[11px] text-muted">{ru ? 'Ответ вводится моноширинно; сверяется с принимаемыми (регистр обычно важен).' : 'Answer is entered monospace; matched against accepted (case usually matters).'}</span>}
          <div className="flex flex-col gap-1.5">
            {accept.map((a, ai) => (
              <div key={ai} className="flex items-center gap-2">
                <span className="w-4 text-right text-[11px] text-muted">✓</span>
                <BubbleTextEditor
                  value={a}
                  onChange={(v) => set({ accept: accept.map((x, xi) => (xi === ai ? v : x)) })}
                  singleLine
                  className="flex-1"
                  lang={ru ? 'ru' : 'en'}
                  ariaLabel={ru ? `Принимаемый ответ ${ai + 1}` : `Accepted answer ${ai + 1}`}
                  placeholder={ru ? `Принимаемый ответ ${ai + 1}` : `Accepted answer ${ai + 1}`}
                />
                <button
                  type="button"
                  onClick={() => set({ accept: accept.filter((_, xi) => xi !== ai) })}
                  disabled={accept.length <= 1}
                  className="text-muted hover:text-danger disabled:opacity-30"
                  aria-label={ru ? 'Удалить ответ' : 'Remove answer'}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[12px]">
            <button type="button" onClick={() => set({ accept: [...accept, ''] })} className="text-accent hover:underline">
              + {ru ? 'вариант ответа' : 'accepted answer'}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
              <Checkbox checked={quiz.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })} />
              {ru ? 'Учитывать регистр' : 'Case-sensitive'}
            </label>
          </div>
          <span className="text-[11px] text-muted">{ru ? 'Любой из принимаемых ответов засчитывается (пробелы/регистр нормализуются).' : 'Any accepted answer counts (whitespace/case normalized).'}</span>
        </>
      )}

      {quiz.kind === 'number' && (
        <div className="flex flex-wrap items-end gap-3 text-[12px]">
          <label className="flex flex-col gap-1 text-ink-2">
            {ru ? 'Верный ответ' : 'Correct answer'}
            <input
              className={`${input} w-32`}
              inputMode="decimal"
              aria-label={ru ? 'Числовой ответ' : 'Numeric answer'}
              placeholder="42"
              value={quiz.answer}
              onChange={(e) => set({ answer: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-ink-2">
            {ru ? 'Допуск ±' : 'Tolerance ±'}
            <input
              className={`${input} w-24`}
              inputMode="decimal"
              aria-label={ru ? 'Допуск' : 'Tolerance'}
              placeholder="0"
              value={quiz.tolerance}
              onChange={(e) => set({ tolerance: e.target.value })}
            />
          </label>
        </div>
      )}

      {quiz.kind === 'blank' && (
        <>
          <textarea
            className="min-h-[52px] w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-hidden focus:border-border-strong"
            aria-label={ru ? 'Текст с пропусками' : 'Text with blanks'}
            placeholder={ru ? 'Текст с пропусками. Пишите ___ там, где пропуск.' : 'Text with blanks. Write ___ where a blank goes.'}
            value={quiz.template}
            onChange={(e) => set({ template: e.target.value })}
          />
          {(() => {
            const n = blankCount(quiz.template)
            if (n === 0) return <span className="text-[11px] text-muted">{ru ? 'Добавьте ___ в текст, чтобы задать пропуски.' : 'Add ___ to the text to create blanks.'}</span>
            return (
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: n }, (_, bi) => (
                  <div key={bi} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">#{bi + 1}</span>
                    <BubbleTextEditor
                      value={quiz.blanks[bi] ?? ''}
                      onChange={(v) => set({ blanks: Array.from({ length: n }, (_, i) => (i === bi ? v : quiz.blanks[i] ?? '')) })}
                      singleLine
                      className="flex-1"
                      lang={ru ? 'ru' : 'en'}
                      ariaLabel={ru ? `Ответы для пропуска ${bi + 1}` : `Answers for blank ${bi + 1}`}
                      placeholder={ru ? 'Принимаемые ответы через запятую' : 'Accepted answers, comma-separated'}
                    />
                  </div>
                ))}
              </div>
            )
          })()}
          <label className="inline-flex cursor-pointer items-center gap-1.5 self-start text-[12px] text-ink-2">
            <Checkbox checked={quiz.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })} />
            {ru ? 'Учитывать регистр' : 'Case-sensitive'}
          </label>
        </>
      )}

      {quiz.kind === 'match' && (() => {
        const pairs = quiz.pairs.length ? quiz.pairs : [{ left: '', right: '' }, { left: '', right: '' }]
        const setPairs = (p: { left: string; right: string }[]) => set({ pairs: p })
        return (
          <>
            <div className="flex flex-col gap-1.5">
              {pairs.map((p, pi) => (
                <div key={pi} className="flex items-center gap-2">
                  <BubbleTextEditor
                    value={p.left}
                    onChange={(v) => setPairs(pairs.map((x, xi) => (xi === pi ? { ...x, left: v } : x)))}
                    singleLine
                    className="flex-1"
                    lang={ru ? 'ru' : 'en'}
                    ariaLabel={ru ? `Слева ${pi + 1}` : `Left ${pi + 1}`}
                    placeholder={ru ? 'Слева' : 'Left'}
                  />
                  <span className="shrink-0 text-muted">→</span>
                  <BubbleTextEditor
                    value={p.right}
                    onChange={(v) => setPairs(pairs.map((x, xi) => (xi === pi ? { ...x, right: v } : x)))}
                    singleLine
                    className="flex-1"
                    lang={ru ? 'ru' : 'en'}
                    ariaLabel={ru ? `Справа ${pi + 1}` : `Right ${pi + 1}`}
                    placeholder={ru ? 'Справа' : 'Right'}
                  />
                  <button
                    type="button"
                    onClick={() => setPairs(pairs.filter((_, xi) => xi !== pi))}
                    disabled={pairs.length <= 2}
                    className="text-muted hover:text-danger disabled:opacity-30"
                    aria-label={ru ? 'Удалить пару' : 'Remove pair'}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-[12px]">
              <button type="button" onClick={() => setPairs([...pairs, { left: '', right: '' }])} className="text-accent hover:underline">
                + {ru ? 'пара' : 'pair'}
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
                <Checkbox checked={quiz.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })} />
                {ru ? 'Учитывать регистр' : 'Case-sensitive'}
              </label>
            </div>
            <span className="text-[11px] text-muted">{ru ? 'Правые части ученику показываются перемешанными.' : 'Right sides are shuffled for the learner.'}</span>
          </>
        )
      })()}

      {quiz.kind === 'sort' && (() => {
        const items = quiz.items.length ? quiz.items : ['', '']
        const setItems = (xs: string[]) => set({ items: xs })
        const move = (i: number, d: -1 | 1) => {
          const j = i + d
          if (j < 0 || j >= items.length) return
          const next = [...items]
          ;[next[i], next[j]] = [next[j], next[i]]
          setItems(next)
        }
        return (
          <>
            <div className="flex flex-col gap-1.5">
              {items.map((it2, ii) => (
                <div key={ii} className="flex items-center gap-1.5">
                  <span className="w-4 text-right font-mono text-[11px] text-muted">{ii + 1}</span>
                  <div className="flex flex-col">
                    <button type="button" onClick={() => move(ii, -1)} disabled={ii === 0} className="text-muted hover:text-ink disabled:opacity-20" aria-label="up"><ChevronUp size={13} /></button>
                    <button type="button" onClick={() => move(ii, 1)} disabled={ii === items.length - 1} className="text-muted hover:text-ink disabled:opacity-20" aria-label="down"><ChevronDown size={13} /></button>
                  </div>
                  <BubbleTextEditor
                    value={it2}
                    onChange={(v) => setItems(items.map((x, xi) => (xi === ii ? v : x)))}
                    singleLine
                    className="flex-1"
                    lang={ru ? 'ru' : 'en'}
                    ariaLabel={ru ? `Элемент ${ii + 1}` : `Item ${ii + 1}`}
                    placeholder={ru ? `Элемент ${ii + 1}` : `Item ${ii + 1}`}
                  />
                  <button type="button" onClick={() => setItems(items.filter((_, xi) => xi !== ii))} disabled={items.length <= 2} className="text-muted hover:text-danger disabled:opacity-30" aria-label={ru ? 'Удалить' : 'Remove'}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 pt-0.5 text-[12px]">
              <button type="button" onClick={() => setItems([...items, ''])} className="text-accent hover:underline">+ {ru ? 'элемент' : 'item'}</button>
              <span className="text-[11px] text-muted">{ru ? 'Задайте ПРАВИЛЬНЫЙ порядок (сверху вниз). Ученику покажем перемешанными.' : 'Set the CORRECT order (top to bottom). Shuffled for the learner.'}</span>
            </div>
          </>
        )
      })()}

      <BubbleTextEditor
        value={quiz.explain}
        onChange={(v) => set({ explain: v })}
        rows={2}
        lang={ru ? 'ru' : 'en'}
        ariaLabel={ru ? 'Пояснение (после проверки)' : 'Explanation (after check)'}
        placeholder={ru ? 'Пояснение — покажется после проверки (необязательно)' : 'Explanation — shown after checking (optional)'}
      />
      <span className="text-[11px] text-muted">
        {ru ? 'Проверка — на странице списка.' : 'Checking happens on the list page.'}
      </span>
    </div>
  )
}

// Text-блок: Markdown со всплывающей панелью форматирования (выдели текст →
// мини-тулбар). Картинки/файлы — отдельными блоками, не в тулбаре.
function TextBlockBody({ value, onChange, ru }: { value: string; onChange: (v: string) => void; ru: boolean }) {
  return (
    <BubbleTextEditor
      value={value}
      onChange={onChange}
      rows={4}
      lang={ru ? 'ru' : 'en'}
      ariaLabel={ru ? 'Текстовый блок (Markdown)' : 'Text block (Markdown)'}
      placeholder={ru ? 'Текст в разметке Markdown…' : 'Markdown text…'}
    />
  )
}

/** Радиальный «+»-инсертер: по клику из кнопки веером («улыбкой») вылетают
 *  кружки типов блоков; нижний-центральный (primary) = повтор предыдущего типа.
 *  between=true — тонкая линия-разделитель, появляется при наведении. */
function BlockInserter({ onInsert, repeatType, ru, between = false }: { onInsert: (t: BlockType) => void; repeatType: BlockType; ru: boolean; between?: boolean }) {
  const [open, setOpen] = useState(false)
  const [hoverK, setHoverK] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Клик вне — закрыть.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // Веер: типы блоков распределяем по дуге над кнопкой. Радиус/разброс с запасом,
  // чтобы 7 кружков не липли друг к другу.
  const arc = BLOCK_TYPES
  const R = 88
  const spread = 172 // градусов
  const start = 90 + spread / 2 // слева
  const pick = (t: BlockType) => { onInsert(t); setOpen(false) }

  return (
    <div ref={rootRef} className={`relative flex items-center justify-center ${between ? 'group h-4 w-full' : ''}`}>
      {between && !open && (
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border opacity-0 transition-opacity group-hover:opacity-100" />
      )}
      {/* Кружки-типы (веером). Появляются при open. */}
      {arc.map((t, k) => {
        const ang = arc.length > 1 ? start - (spread / (arc.length - 1)) * k : 90
        const rad = (ang * Math.PI) / 180
        const hovered = hoverK === k
        const rr = hovered ? R + 14 : R // при наведении — «выдвигаем» наружу
        const x = Math.cos(rad) * rr
        const y = -Math.sin(rad) * rr
        const Icon = BLOCK_ICON[t]
        return (
          <Tooltip key={t} label={blockLabel(t, ru)}>
            <button
              type="button"
              aria-label={blockLabel(t, ru)}
              onClick={() => pick(t)}
              onMouseEnter={() => setHoverK(k)}
              onMouseLeave={() => setHoverK((h) => (h === k ? null : h))}
              onFocus={() => setHoverK(k)}
              onBlur={() => setHoverK((h) => (h === k ? null : h))}
              tabIndex={open ? 0 : -1}
              className={`absolute grid h-10 w-10 place-items-center rounded-full border shadow-md transition-all duration-200 motion-reduce:transition-none ${
                hovered ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border bg-surface text-ink'
              }`}
              style={{
                transform: open ? `translate(${x}px, ${y}px) scale(${hovered ? 1.18 : 1})` : 'translate(0,0) scale(0.3)',
                opacity: open ? 1 : 0,
                pointerEvents: open ? 'auto' : 'none',
                zIndex: open ? (hovered ? 22 : 20) : undefined,
              }}
            >
              <Icon size={16} />
            </button>
          </Tooltip>
        )
      })}
      {/* Повтор предыдущего типа — нижний-центральный, чуть под кнопкой. */}
      {(() => {
        const Icon = BLOCK_ICON[repeatType]
        return (
          <Tooltip label={`${ru ? 'Как предыдущий' : 'Same as previous'}: ${blockLabel(repeatType, ru)}`}>
            <button
              type="button"
              aria-label={`${ru ? 'Повторить' : 'Repeat'}: ${blockLabel(repeatType, ru)}`}
              onClick={() => pick(repeatType)}
              tabIndex={open ? 0 : -1}
              className="absolute grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-fg shadow-md transition-all duration-200 hover:opacity-90 motion-reduce:transition-none"
              style={{
                transform: open ? `translate(0, ${R + 6}px) scale(1)` : 'translate(0,0) scale(0.3)',
                opacity: open ? 1 : 0,
                pointerEvents: open ? 'auto' : 'none',
                zIndex: open ? 20 : undefined,
              }}
            >
              <Icon size={15} />
            </button>
          </Tooltip>
        )
      })()}
      {/* Центральная «+» кнопка. */}
      <button
        type="button"
        aria-label={ru ? 'Добавить блок' : 'Add block'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`z-1 grid place-items-center rounded-full border transition-all ${
          between ? 'h-7 w-7 opacity-0 group-hover:opacity-100' : 'h-11 w-11'
        } ${open ? 'rotate-45 border-accent bg-accent text-white' : 'border-border bg-surface text-ink-2 hover:border-border-strong hover:text-ink'} ${open ? 'opacity-100' : ''}`}
      >
        <Plus size={between ? 15 : 20} />
      </button>
    </div>
  )
}

// StepImageInput / VideoFileInput / FileDropInput заменены общим
// shared/ui/UploadDropzone (с реальным прогрессом загрузки).
