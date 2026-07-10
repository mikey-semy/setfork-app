// Чистая проверка «этот handle — админ?» (env ADMIN_HANDLES, через запятую).
// Отдельно от admin.ts: без next/headers и БД — импортируется в middleware.

/** Админ определяется ником из env ADMIN_HANDLES (через запятую). */
export function isAdminHandle(handle: string | null | undefined): boolean {
  if (!handle) return false
  const h = handle.toLowerCase()
  // Общий demo-аккаунт НИКОГДА не админ в проде: demo-вход публичен (dev-фолбэк без
  // GitHub OAuth), иначе любой кликнувший «demo» получил бы полные права админа.
  if (h === 'demo' && process.env.NODE_ENV === 'production') return false
  const list = (process.env.ADMIN_HANDLES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(h)
}
