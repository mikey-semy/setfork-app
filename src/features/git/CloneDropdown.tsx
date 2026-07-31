'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Code2, Copy, FileCode, FileDown, GitBranch, Printer, Sparkles, Terminal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { t, type Lang } from '@/shared/i18n'

type TabKey = 'clone' | 'run' | 'embed'

/** Кнопка «Use»: КАК использовать список — clone/bundle, run-скрипт + экспорт,
 *  MCP для агентов + embed. Разбито на три вкладки, чтобы меню было компактным.
 *  Start run живёт ОТДЕЛЬНОЙ кнопкой рядом (см. list page), не здесь. */
export function CloneDropdown({ base, lang }: { base: string; lang: Lang }) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('clone')
  useEffect(() => setOrigin(window.location.origin), [])

  const cloneUrl = `${origin}${base}.git`
  const mcpUrl = `${origin}/api/mcp`
  const embedCode = `<iframe src="${origin}${base}/embed" width="100%" height="480" style="border:1px solid #ddd;border-radius:8px" loading="lazy"></iframe>`

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    })
  }

  const heading = (icon: React.ReactNode, label: string) => (
    <SectionLabel className="mb-1.5 flex items-center gap-1.5">
      {icon} {label}
    </SectionLabel>
  )
  const copyField = (key: string, value: string, mono = true) => (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={`min-w-0 flex-1 bg-transparent text-[0.78125rem] text-ink outline-hidden ${mono ? 'font-mono' : ''}`}
      />
      <button type="button" onClick={() => copy(key, value)} aria-label={t('copyUrl', lang)} className="shrink-0 text-muted hover:text-ink">
        {copied === key ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </button>
    </div>
  )
  const row = 'flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[0.78125rem] text-ink-2 hover:bg-surface-2 hover:text-ink'

  const ru = lang === 'ru'
  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'clone', label: ru ? 'Клон' : 'Clone', icon: <GitBranch size={13} /> },
    { key: 'run', label: ru ? 'Запуск' : 'Run', icon: <Terminal size={13} /> },
    { key: 'embed', label: ru ? 'Встроить' : 'Embed', icon: <Code2 size={13} /> },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Фиксированная высота 36px (h-9) — ряд действий панели списка ровный. */}
        {/* Первичное действие списка — заливкой, как зелёная Code у GitHub, но своим
            токеном темы (--ok-solid читается с белым текстом в обеих темах). Иконки нет:
            текст короткий и однозначный, а рядом стоит синяя кнопка прогона — два
            цветных значка в ряд спорили бы за внимание. */}
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-(--ok-solid) px-3.5 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t('cloneMenuLabel', lang)} <ChevronDown size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[20.625rem] p-0">
        {/* Сегментированные вкладки — держат меню компактным. */}
        <div className="flex border-b border-border p-1">
          {TABS.map((tt) => (
            <button
              key={tt.key}
              type="button"
              onClick={() => setTab(tt.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.78125rem] font-semibold transition-colors ${
                tab === tt.key ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {tt.icon} {tt.label}
            </button>
          ))}
        </div>

        <div className="p-3">
          {tab === 'clone' && (
            <>
              {heading(<Terminal size={12} />, t('cloneGitHeading', lang))}
              {copyField('clone', cloneUrl)}
              <p className="mt-1 text-[0.6875rem] text-ink-2">{t('cloneHttpsHint', lang)}</p>
              <a href={`${base}/repo.bundle`} className={`${row} mt-1.5`}>
                <GitBranch size={14} className="text-muted" /> {t('downloadBundle', lang)}
              </a>
            </>
          )}

          {tab === 'run' && (
            <>
              {/* Run — исполняемый скрипт (gist-стиль): bash + PowerShell */}
              {heading(<Terminal size={12} />, t('runHeading', lang))}
              {copyField('run', `curl -fsSL ${origin}${base}/raw | bash`)}
              <div className="mt-1.5">{copyField('run-ps', `irm "${origin}${base}/raw?lang=ps1" | iex`)}</div>
              <p className="mt-1 text-[0.6875rem] text-ink-2">{t('runHint', lang)}</p>
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
            </>
          )}

          {tab === 'embed' && (
            <>
              {heading(<Sparkles size={12} />, t('mcpHeading', lang))}
              {copyField('mcp', mcpUrl)}
              <p className="mt-1 text-[0.6875rem] text-ink-2">{t('mcpHint', lang)}</p>
              <Link href="/settings#mcp" className="mt-1 inline-block text-[0.78125rem] text-accent hover:underline">
                {t('getTokenLink', lang)}
              </Link>

              <div className="mt-2.5 border-t border-border pt-2">
                {heading(<Code2 size={12} />, t('embedHeading', lang))}
                <div className="flex items-start gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
                  <textarea
                    readOnly
                    value={embedCode}
                    rows={3}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 resize-none bg-transparent font-mono text-[0.6875rem] leading-snug text-ink outline-hidden"
                  />
                  <button type="button" onClick={() => copy('embed', embedCode)} aria-label={t('copyUrl', lang)} className="shrink-0 text-muted hover:text-ink">
                    {copied === 'embed' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="mt-1 text-[0.6875rem] text-ink-2">{t('embedHint', lang)}</p>
              </div>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
