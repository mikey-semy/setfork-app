'use client'

import { useEffect } from 'react'
import { captureError } from '@/shared/observability'

// Ловит краш КОРНЕВОГО layout — когда app/error.tsx отрисоваться уже не может.
// Рендерит собственные <html>/<body>; глобальный CSS в этот момент недоступен
// (его подключал упавший layout), поэтому только инлайн-стили, светлая тема.
// Текст в обе локали разом: язык надёжно не определить без layout-контекста.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    captureError(error, { where: 'app/global-error', digest: error.digest })
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf9f7',
          color: '#1c1c1a',
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, lineHeight: 1 }}>⚠️</div>
          <h1 style={{ margin: '16px 0 8px', fontSize: 20, fontWeight: 700 }}>Something went wrong / Что-то пошло не так</h1>
          <p style={{ margin: 0, fontSize: 14, color: '#6b6b66' }}>
            An unexpected error occurred. / Произошла непредвиденная ошибка.
          </p>
          {/* ui-parity-ok: аварийная страница рисуется без CSS проекта — упал корневой layout, globals.css мог не приехать */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '10px 18px',
              borderRadius: 8,
              border: 0,
              background: '#1c1c1a',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload / Обновить
          </button>
        </div>
      </body>
    </html>
  )
}
