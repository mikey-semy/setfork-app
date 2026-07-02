import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'
import typography from '@tailwindcss/typography'

// Цвета — семантические токены из дизайна SetHub (см. globals.css :root / .dark).
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1200px' } },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        primary: 'var(--primary)',
        'primary-fg': 'var(--primary-fg)',
        cur: 'var(--cur)',
        // rgb-триплет + <alpha-value> — чтобы работали bg-ok/10, border-danger/40 и т.п.
        ok: 'rgb(var(--ok-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
      },
      borderRadius: { xl: '16px', lg: '11px', md: '9px', sm: '7px' },
      boxShadow: {
        card: '0 30px 80px -30px rgba(0,0,0,.35)',
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
}

export default config
