'use client'

import { createContext, useContext, useEffect, useState } from 'react'

// Общее состояние ОДНОГО сайдбара: свёрнут/развёрнут (desktop, память в LS) и
// открыт оверлеем (мобилка, дёргает бургер в топ-баре). Провайдер оборачивает
// TopNav + Sidebar в layout, чтобы бургер и сайдбар были одним элементом.
type Ctx = {
  collapsed: boolean
  toggleCollapsed: () => void
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
}

const SidebarCtx = createContext<Ctx | null>(null)
const LS_KEY = 'sf.sidebar.collapsed'

export function useSidebar(): Ctx {
  const c = useContext(SidebarCtx)
  if (!c) throw new Error('useSidebar: нет SidebarProvider')
  return c
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Восстанавливаем выбор пользователя после гидрации (SSR не знает LS).
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY) === '1') setCollapsed(true)
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
      try {
        localStorage.setItem(LS_KEY, next ? '1' : '0')
      } catch {}
      return next
    })

  return <SidebarCtx.Provider value={{ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }}>{children}</SidebarCtx.Provider>
}
