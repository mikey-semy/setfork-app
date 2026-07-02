'use client'

import { useEffect } from 'react'
import { markNotificationsRead } from './actions'

/** Помечает уведомления прочитанными при открытии страницы (сбрасывает бейдж). */
export function MarkRead() {
  useEffect(() => {
    void markNotificationsRead()
  }, [])
  return null
}
