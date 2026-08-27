'use client'

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Spinner } from '@/shared/ui/Spinner'
import { IconButton } from '@/shared/ui/IconButton'
import type { Lang } from '@/shared/i18n'
import { resolveChip, type CustomLabel } from '@/shared/lib/labels'
import { bulkSuggestionAction } from './suggestion-meta-actions'
import { Alert } from '@/shared/ui/Alert'

export interface BulkLabels {
  selectAll: string
  selected: string
  clear: string
  label: string
  milestone: string
  close: string
}

/**
 * Выбор строк живёт в контексте, а строки рисует СЕРВЕРНАЯ страница.
 *
 * Так и должно быть в RSC: клиентским остаётся только то, что имеет состояние
 * (галочка и панель действий), а разметка строк не уезжает в браузер. Соблазн
 * передать строки render-prop'ом (`children={({checkbox}) => …}`) — ловушка:
 * функции через границу сервер→клиент не сериализуются, и список молча
 * перестаёт отрисовываться (поймано живой проверкой).
 */
const SelCtx = createContext<{ sel: string[]; toggle: (id: string) => void; label: string } | null>(null)

/** Галочка одной строки — островок внутри серверной разметки списка. */
export function SuggestionCheckbox({ id }: { id: string }) {
  const ctx = useContext(SelCtx)
  if (!ctx) return null // прав на пакетные действия нет — выбора тоже нет
  return (
    // Тач-цель: сам input мелкий, обёртка добирает до полной цели.
    <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
      <Checkbox checked={ctx.sel.includes(id)} onChange={() => ctx.toggle(id)} aria-label={ctx.label} />
    </label>
  )
}

/**
 * Множественный выбор в списке предложений — как в списке PR у GitHub: отметил
 * несколько строк, поставил метку или закрыл разом.
 *
 * Панель действий появляется только когда что-то выбрано и НЕ перекрывает
 * список: она в потоке, над ним. Плавающая панель на мобиле закрывала бы нижние
 * строки — те самые, до которых человек только что доскроллил.
 */
export function SuggestionSelection({
  ids,
  canManage,
  custom,
  milestones,
  lang,
  labels,
  children,
}: {
  /** id всех строк на экране — для «выбрать все». */
  ids: string[]
  /** Пакетные действия — только тем, кто ведёт предложения. */
  canManage: boolean
  /** Кастомные метки списка — те же, что у задач. */
  custom: CustomLabel[]
  milestones: { id: string; title: string }[]
  lang: Lang
  labels: BulkLabels
  children: ReactNode
}) {
  const [sel, setSel] = useState<string[]>([])
  const [pending, start] = useTransition()

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const run = (op: Parameters<typeof bulkSuggestionAction>[1]) =>
    start(async () => {
      await bulkSuggestionAction(sel, op)
      setSel([])
    })

  if (!canManage) return <>{children}</>

  return (
    <SelCtx.Provider value={{ sel, toggle, label: labels.selected }}>
      {/* Действия — вправо; на мобиле строка действий занимает всю ширину,
          чтобы кнопки не жались к краю и не липли к тексту. */}
      {sel.length > 0 && (
        <Alert
          variant="accent"
          icon={null}
          className="mb-2"
          action={
            <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
            <BulkMenu
              label={labels.label}
              disabled={pending}
              items={custom.map((c) => ({ key: c.id, text: resolveChip(`c:${c.id}`, custom, lang).text }))}
              onPick={(key) => run({ kind: 'label', label: `c:${key}` })}
            />
            <BulkMenu
              label={labels.milestone}
              disabled={pending}
              items={milestones.map((m) => ({ key: m.id, text: m.title }))}
              onPick={(key) => run({ kind: 'milestone', milestoneId: key })}
            />
            <Button variant="ghost" disabled={pending} onClick={() => run({ kind: 'close' })}>
              {pending ? <Spinner size="md" /> : labels.close}
            </Button>
            <Tooltip label={labels.clear}>
              <IconButton size="xl" variant="ghost" label={labels.clear} className="shrink-0 text-muted hover:text-ink" onClick={() => setSel([])}>
                <X size={15} />
              </IconButton>
            </Tooltip>
            </div>
          }
        >
          <span className="font-semibold text-ink">
            {labels.selected}: {sel.length}
          </span>
        </Alert>
      )}

      {ids.length > 0 && (
        <label className="mb-2 inline-flex h-11 cursor-pointer items-center gap-2 px-1 text-body-sm text-ink-2">
          <Checkbox
            checked={sel.length === ids.length}
            onChange={() => setSel((s) => (s.length === ids.length ? [] : ids))}
            aria-label={labels.selectAll}
          />
          {labels.selectAll}
        </label>
      )}

      {children}
    </SelCtx.Provider>
  )
}

/** Дропдаун пакетного действия — тот же примитив, что у фильтров списка. */
function BulkMenu({
  label,
  items,
  onPick,
  disabled,
}: {
  label: string
  items: { key: string; text: string }[]
  onPick: (key: string) => void
  disabled: boolean
}) {
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="md" disabled={disabled}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-field-lg">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {items.map((it) => (
          <DropdownMenuItem key={it.key} onClick={() => onPick(it.key)} className="cursor-pointer">
            <span className="truncate">{it.text}</span>
            <Check size={14} className="ml-auto shrink-0 opacity-0" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
