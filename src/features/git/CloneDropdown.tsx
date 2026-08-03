'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Braces, ChevronDown, Code2, FileCode, FileDown, GitBranch, Printer, Sparkles, Terminal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { CodeCard } from '@/shared/ui/CodeCard'
import { CopyButton } from '@/shared/ui/CopyButton'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { t, type Lang } from '@/shared/i18n'

type TabKey = 'clone' | 'run' | 'embed'
const TAB_ORDER: TabKey[] = ['clone', 'run', 'embed']

/** Кнопка «Use»: КАК использовать список — clone/bundle, run-скрипт + экспорт,
 *  MCP для агентов + embed. Разбито на три вкладки, чтобы меню было компактным.
 *  Start run живёт ОТДЕЛЬНОЙ кнопкой рядом (см. list page), не здесь.
 *
 *  Поповер, а не DropdownMenu: меню Radix перехватывает Tab и водит фокус только
 *  по своим пунктам, а здесь содержимое — поля, вкладки и ссылки. С меню всё это
 *  было недостижимо с клавиатуры, то есть ЕДИНСТВЕННЫЙ вход в /raw, data.json и
 *  MCP открывался только мышью. */
export function CloneDropdown({ base, lang }: { base: string; lang: Lang }) {
  const [origin, setOrigin] = useState('')
  const [tab, setTab] = useState<TabKey>('clone')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  useEffect(() => setOrigin(window.location.origin), [])

  const cloneUrl = `${origin}${base}.git`
  const mcpUrl = `${origin}/api/mcp`
  // Список как ДАННЫЕ — близнец /raw: тот отдаёт скрипт, этот json со строками и версией.
  const dataUrl = `${origin}${base}/data.json`
  const embedCode = `<iframe src="${origin}${base}/embed" width="100%" height="480" style="border:1px solid #ddd;border-radius:8px" loading="lazy"></iframe>`


  const heading = (icon: React.ReactNode, label: string) => (
    <SectionLabel className="mb-1.5 flex items-center gap-1.5">
      {icon} {label}
    </SectionLabel>
  )

  /** Адрес для копирования: значение выделяемо, кнопка — общий примитив с тач-целью. */
  const copyField = (value: string, mono = true) => (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={`min-w-0 flex-1 bg-transparent text-[0.78125rem] text-ink outline-hidden ${mono ? 'font-mono' : ''}`}
      />
      <CopyButton text={value} lang={lang} />
    </div>
  )

  // Строка-действие: тач-цель добирается на крупном указателе (Apple HIG 44px).
  const row =
    'flex min-h-8 items-center gap-2 rounded-md px-1.5 py-1.5 text-[0.78125rem] text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-11'

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'clone', label: t('useTabClone', lang), icon: <GitBranch size={13} /> },
    { key: 'run', label: t('useTabRun', lang), icon: <Terminal size={13} /> },
    { key: 'embed', label: t('useTabEmbed', lang), icon: <Code2 size={13} /> },
  ]

  // Стрелки внутри ряда вкладок — ожидаемое поведение таб-листа (WAI-ARIA).
  const onTabKeyDown = (e: React.KeyboardEvent, key: TabKey) => {
    const i = TAB_ORDER.indexOf(key)
    const next = e.key === 'ArrowRight' ? TAB_ORDER[(i + 1) % TAB_ORDER.length] : e.key === 'ArrowLeft' ? TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length] : null
    if (!next) return
    e.preventDefault()
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Высота из шкалы (CONTROL_H.md = 32px) — ряд действий панели списка ровный. */}
        {/* Первичное действие списка — заливкой, как зелёная Code у GitHub, но своим
            токеном темы (--ok-solid читается с белым текстом в обеих темах). Иконки нет:
            текст короткий и однозначный, а рядом стоит синяя кнопка прогона — два
            цветных значка в ряд спорили бы за внимание. */}
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-(--ok-solid) px-3.5 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t('cloneMenuLabel', lang)} <ChevronDown size={13} />
        </button>
      </PopoverTrigger>
      {/* Ширина не шире экрана (на масштабе 110% фикс-330px уезжал за край), высота —
          не выше доступной, иначе низ вкладки «Запуск» обрезался без прокрутки. */}
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-1.5rem))] max-h-(--radix-popover-content-available-height) overflow-y-auto p-0"
      >
        <div className="flex gap-2 border-b border-border p-1.5" role="tablist" aria-label={t('cloneMenuLabel', lang)}>
          {TABS.map((tt) => (
            <button
              key={tt.key}
              ref={(el) => {
                tabRefs.current[tt.key] = el
              }}
              type="button"
              role="tab"
              id={`use-tab-${tt.key}`}
              aria-selected={tab === tt.key}
              aria-controls={`use-panel-${tt.key}`}
              tabIndex={tab === tt.key ? 0 : -1}
              onClick={() => setTab(tt.key)}
              onKeyDown={(e) => onTabKeyDown(e, tt.key)}
              className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[0.78125rem] font-semibold transition-colors pointer-coarse:min-h-11 ${
                tab === tt.key ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {tt.icon} {tt.label}
            </button>
          ))}
        </div>

        <div className="p-3">
          {tab === 'clone' && (
            <div role="tabpanel" id="use-panel-clone" aria-labelledby="use-tab-clone">
              {heading(<Terminal size={12} />, t('cloneGitHeading', lang))}
              {copyField(cloneUrl)}
              <p className="mt-1 text-[0.78125rem] text-ink-2">{t('cloneHttpsHint', lang)}</p>
              <p className="mt-1 text-[0.78125rem] text-ink-2">{t('cloneAuthHint', lang)}</p>
              <a href={`${base}/repo.bundle`} className={`${row} mt-1.5`}>
                <GitBranch size={14} className="text-muted" /> {t('downloadBundle', lang)}
              </a>
            </div>
          )}

          {tab === 'run' && (
            <div role="tabpanel" id="use-panel-run" aria-labelledby="use-tab-run">
              {/* Run — исполняемый скрипт (gist-стиль): bash + PowerShell.
                  Команда показывается КАРТОЧКОЙ КОДА с переносом: в однострочном поле
                  было видно меньше трети команды, и `| bash` оставался за краем — то
                  есть подсказка «сначала проверь» относилась к невидимому тексту. */}
              {heading(<Terminal size={12} />, t('runHeading', lang))}
              <CodeCard code={`curl -fsSL ${origin}${base}/raw | bash`} name="bash" lang={lang} />
              <CodeCard code={`irm "${origin}${base}/raw?lang=ps1" | iex`} name="powershell" lang={lang} />
              <p className="mt-1 text-[0.78125rem] text-ink-2">{t('runHint', lang)}</p>
              <a href={`${base}/raw`} className={`${row} mt-1`}>
                <FileCode size={14} className="text-muted" /> {t('viewRaw', lang)}
              </a>

              <div className="mt-2.5 border-t border-border pt-2">
                {heading(<FileDown size={12} />, t('exportHeading', lang))}
                <button type="button" onClick={() => window.print()} className={`${row} w-full text-left`}>
                  <Printer size={14} className="text-muted" /> {t('printPdf', lang)}
                </button>
                <a href={`${base}/export?format=md`} className={row}>
                  <FileDown size={14} className="text-muted" /> {t('exportMd', lang)}
                </a>
                <a href={`${base}/export?format=html`} className={row}>
                  <FileCode size={14} className="text-muted" /> {t('exportHtml', lang)}
                </a>
              </div>
            </div>
          )}

          {tab === 'embed' && (
            <div role="tabpanel" id="use-panel-embed" aria-labelledby="use-tab-embed">
              {/* Данные идут ПЕРВЫМИ: это самый частый программный сценарий — забрать список
                  json'ом. MCP ниже нужен агенту, iframe — сайту. */}
              {heading(<Braces size={12} />, t('dataHeading', lang))}
              {copyField(dataUrl)}
              <p className="mt-1 text-[0.78125rem] text-ink-2">{t('dataHint', lang)}</p>
              <a href={`${base}/data.json`} className={`${row} mt-1`}>
                <Braces size={14} className="text-muted" /> {t('openData', lang)}
              </a>

              <div className="mt-2.5 border-t border-border pt-2">
                {heading(<Sparkles size={12} />, t('mcpHeading', lang))}
                {copyField(mcpUrl)}
                <p className="mt-1 text-[0.78125rem] text-ink-2">{t('mcpHint', lang)}</p>
                <Link href="/settings#mcp" className={`${row} mt-1 text-accent hover:underline`}>
                  {t('getTokenLink', lang)}
                </Link>
              </div>

              <div className="mt-2.5 border-t border-border pt-2">
                {heading(<Code2 size={12} />, t('embedHeading', lang))}
                <CodeCard code={embedCode} name="iframe" lang={lang} />
                <p className="mt-1 text-[0.78125rem] text-ink-2">{t('embedHint', lang)}</p>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
