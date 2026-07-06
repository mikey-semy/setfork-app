'use client'

import { useEffect } from 'react'

/** Ставит `html[data-hydrated="true"]` после гидрации. Сигнал для автоматизации
 *  (setfork-sim / Playwright / e2e): дождаться его перед вводом в формы, иначе
 *  печать до гидрации в контролируемые клиентские инпуты теряется (гонка гидрации).
 *  Для людей безвреден; в контролируемые формы никто не печатает в первые ~мс. */
export function HydrationSignal() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])
  return null
}
