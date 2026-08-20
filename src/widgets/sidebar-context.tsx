'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { SIDEBAR_COOKIE } from '@/shared/lib/sidebar-cookie'

// Общее состояние ОДНОГО сайдбара: свёрнут/развёрнут (desktop, память в LS) и
// открыт оверлеем (мобилка, дёргает бургер в топ-баре). Провайдер оборачивает
// TopNav + Sidebar в layout, чтобы бургер и сайдбар были одним элементом.
type Ctx = {
  collapsed: boolean
  toggleCollapsed: () => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  /** Бургер в шапке: на десктопе сворачивает сайдбар, на мобилке открывает оверлей. */
  toggle: () => void
}

const SidebarCtx = createContext<Ctx | null>(null)
const LS_KEY = 'sf.sidebar.collapsed'
// Имя куки живёт в общем модуле: серверу из 'use client' можно брать только компоненты.
export { SIDEBAR_COOKIE } from '@/shared/lib/sidebar-cookie'
/** Год: это настройка вида, а не сессия. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Кука видна серверу на следующем запросе — на ней и держится отсутствие прыжка. */
function writeCookie(collapsed: boolean): void {
  try {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? '1' : '0'}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
  } catch {}
}

export function useSidebar(): Ctx {
  const c = useContext(SidebarCtx)
  if (!c) throw new Error('useSidebar: нет SidebarProvider')
  return c
}

/**
 * Начальное состояние приходит С СЕРВЕРА — куки, а не localStorage.
 *
 * Раньше выбор жил только в localStorage, а сервер о нём не знал: страница приезжала со
 * свёрнутым сайдбаром, эффект после гидрации разворачивал его, и развернувший видел
 * прыжок на каждом переходе. Лишняя перерисовка — это и есть замечание авто-ревью
 * (react-doctor/no-initialize-state по #811), но чинить его сменой хука было бы лечением
 * симптома: сервер всё равно рисовал бы не то, пока не знает выбора.
 *
 * localStorage остаётся ЧИТАТЬСЯ ради тех, кто уже разворачивал сайдбар до этой правки:
 * первый заход переносит их выбор в куку. Писать в него больше незачем.
 */
export function SidebarProvider({ children, initialCollapsed = true }: { children: React.ReactNode; initialCollapsed?: boolean }) {
  // ПО УМОЛЧАНИЮ СВЁРНУТ. Раньше открывался развёрнутым, и на дашборде получалось два
  // списка рядом: панель «Топ списков» в сайдбаре и модуль «Списки» в основной области —
  // одно и то же, дважды и одновременно. Свёрнутый сайдбар оставляет навигацию (значки на
  // месте), а место отдаёт содержимому.
  //
  // Развернувшего это НЕ трогает: его выбор приезжает с сервера кукой.
  // Меняется только состояние ПЕРВОГО захода, когда выбора ещё нет.
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)

  // ПЕРЕНОС старого выбора: у тех, кто разворачивал сайдбар до перехода на куку, он лежит
  // в localStorage, а сервер его не видит. Один раз переносим и больше туда не пишем.
  // Кука уже есть — значит перенос сделан, и localStorage игнорируется.
  useEffect(() => {
    if (document.cookie.includes(`${SIDEBAR_COOKIE}=`)) return
    try {
      const legacy = localStorage.getItem(LS_KEY)
      if (legacy !== '0' && legacy !== '1') return
      const wasCollapsed = legacy === '1'
      writeCookie(wasCollapsed)
      setCollapsed(wasCollapsed)
    } catch {}
  }, [])

  // Escape закрывает мобильный оверлей.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v
      writeCookie(next)
      return next
    })

  // Бургер один, а поведение зависит от ширины: десктоп — свернуть/развернуть,
  // мобилка — открыть сайдбар оверлеем (там сворачивать нечего).
  const toggle = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) toggleCollapsed()
    else setMobileOpen(true)
  }

  return <SidebarCtx.Provider value={{ collapsed, toggleCollapsed, mobileOpen, setMobileOpen, toggle }}>{children}</SidebarCtx.Provider>
}
