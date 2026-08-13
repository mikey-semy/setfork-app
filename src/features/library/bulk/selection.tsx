'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * РЕЖИМ ВЫБОРА — состояние на всю вкладку списков.
 *
 * Почему режим, а не постоянные флажки у каждой карточки (как в Gmail или в уведомлениях
 * GitHub): у них строка таблицы, у нас карточка, и колонка под флажок отъедала бы ширину на
 * телефоне всегда — ради действия, которое случается раз в месяц. В мобильных галереях и
 * файловых менеджерах та же задача решена режимом: пока он выключен, карточка ведёт себя
 * как ссылка; включён — вся карточка становится целью нажатия, и промахнуться нечем.
 *
 * Хранится здесь, а не в адресе: выбор — это черновик намерения, а не состояние страницы;
 * в ссылке ему делать нечего, и перезагрузка обязана его сбросить.
 */
export interface SelectionState {
  active: boolean
  ids: Set<string>
  has(id: string): boolean
  toggle(id: string): void
  /** Включить режим (сразу с готовым набором — например «все на странице»). */
  start(ids?: string[]): void
  set(ids: string[]): void
  /** Выйти из режима и забыть выбор. */
  stop(): void
}

const SelectionCtx = createContext<SelectionState | null>(null)

/** Состояние выбора или null — вне провайдера карточка просто остаётся карточкой. */
export function useSelection(): SelectionState | null {
  return useContext(SelectionCtx)
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const [ids, setIds] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const value = useMemo<SelectionState>(
    () => ({
      active,
      ids,
      has: (id) => ids.has(id),
      toggle,
      start: (seed) => {
        setActive(true)
        if (seed) setIds(new Set(seed))
      },
      set: (next) => setIds(new Set(next)),
      stop: () => {
        setActive(false)
        setIds(new Set())
      },
    }),
    [active, ids, toggle],
  )

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>
}
