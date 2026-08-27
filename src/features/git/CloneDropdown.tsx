'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Braces, ChevronDown, Code2, FileCode, FileDown, GitBranch, Printer, Sparkles, Terminal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { CopyRow } from '@/shared/ui/CopyRow'
import { buttonClass } from '@/shared/ui/button-style'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { AUTHORED_DIALECT, dialectSpec, scriptFilename } from '@/core/domain/script-dialect'
import { t, type Lang } from '@/shared/i18n'
import { MenuItem } from '@/shared/ui/MenuItem'

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
export function CloneDropdown({ base, slug, lang }: { base: string; slug: string; lang: Lang }) {
  const [origin, setOrigin] = useState('')
  const [tab, setTab] = useState<TabKey>('clone')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  useEffect(() => setOrigin(window.location.origin), [])

  const cloneUrl = `${origin}${base}.git`
  const mcpUrl = `${origin}/api/mcp`
  // Список как ДАННЫЕ — близнец /raw: тот отдаёт скрипт, этот json со строками и версией.
  const dataUrl = `${origin}${base}/data.json`
  const embedCode = `<iframe src="${origin}${base}/embed" width="100%" height="480" style="border:1px solid #ddd;border-radius:8px" loading="lazy"></iframe>`
  const runCommand = dialectSpec(AUTHORED_DIALECT).run(`${origin}${base}/raw`, scriptFilename(slug, AUTHORED_DIALECT))

  const heading = (icon: React.ReactNode, label: string) => (
    <SectionLabel className="mb-1.5 flex items-center gap-1.5">
      {icon} {label}
    </SectionLabel>
  )

  /** Адрес для копирования: значение выделяется по касанию, высота — из шкалы. */
  const copyField = (value: string, label: string) => <CopyRow value={value} lang={lang} selectLabel={label} />


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
          className={buttonClass({ variant: 'ok' })}
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
              className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-body-sm font-semibold transition-colors pointer-coarse:min-h-11 ${
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
              {copyField(cloneUrl, t('cloneGitHeading', lang))}
              <p className="mt-1 text-body-sm text-ink-2">{t('cloneHttpsHint', lang)}</p>
              <p className="mt-1 text-body-sm text-ink-2">{t('cloneAuthHint', lang)}</p>
              <MenuItem href={`${base}/repo.bundle`} className="mt-1.5">
                <GitBranch size={14} className="text-muted" /> {t('downloadBundle', lang)}
              </MenuItem>
            </div>
          )}

          {tab === 'run' && (
            <div role="tabpanel" id="use-panel-run" aria-labelledby="use-tab-run">
              {/* Команда берётся ИЗ КАТАЛОГА ДИАЛЕКТОВ, а не пишется здесь руками:
                  ровно эту же строку печатает шапка самого скрипта, и написанные в двух
                  местах — они разъезжались. PowerShell-формы тут больше нет: обёртка
                  диалекта не переводит авторские команды, и `/raw?lang=ps1` на списке с
                  командами отвечает 406, а не скриптом (см. script-dialect.ts).

                  Поле намеренно ОДНОСТРОЧНОЕ: длинный URL/имя файла раньше превращали
                  команду в карточку на пол-поповера, хотя здесь важны копирование и
                  доступ к raw, а не чтение обёртки по словам. */}
              {heading(<Terminal size={12} />, t('runHeading', lang))}
              {copyField(runCommand, t('runHeading', lang))}
              <p className="mt-1 text-body-sm text-ink-2">{t('runHint', lang)}</p>
              <p className="mt-1 text-body-sm text-ink-2">{t('runShellOnlyHint', lang)}</p>
              <MenuItem href={`${base}/raw`} className="mt-1">
                <FileCode size={14} className="text-muted" /> {t('viewRaw', lang)}
              </MenuItem>

              <div className="mt-2.5 border-t border-border pt-2">
                {heading(<FileDown size={12} />, t('exportHeading', lang))}
                <MenuItem onClick={() => window.print()}>
                  <Printer size={14} className="text-muted" /> {t('printPdf', lang)}
                </MenuItem>
                <MenuItem href={`${base}/export?format=md`}>
                  <FileDown size={14} className="text-muted" /> {t('exportMd', lang)}
                </MenuItem>
                <MenuItem href={`${base}/export?format=html`}>
                  <FileCode size={14} className="text-muted" /> {t('exportHtml', lang)}
                </MenuItem>
              </div>
            </div>
          )}

          {tab === 'embed' && (
            <div role="tabpanel" id="use-panel-embed" aria-labelledby="use-tab-embed">
              {/* Данные идут ПЕРВЫМИ: это самый частый программный сценарий — забрать список
                  json'ом. MCP ниже нужен агенту, iframe — сайту. */}
              {heading(<Braces size={12} />, t('dataHeading', lang))}
              {copyField(dataUrl, t('dataHeading', lang))}
              <p className="mt-1 text-body-sm text-ink-2">{t('dataHint', lang)}</p>
              <MenuItem href={`${base}/data.json`} className="mt-1">
                <Braces size={14} className="text-muted" /> {t('openData', lang)}
              </MenuItem>

              <div className="mt-2.5 border-t border-border pt-2">
                {heading(<Sparkles size={12} />, t('mcpHeading', lang))}
                {copyField(mcpUrl, t('mcpHeading', lang))}
                <p className="mt-1 text-body-sm text-ink-2">{t('mcpHint', lang)}</p>
                <MenuItem href="/settings#mcp" className="mt-1 text-accent hover:underline">
                  {t('getTokenLink', lang)}
                </MenuItem>
              </div>

              <div className="mt-2.5 border-t border-border pt-2">
                {heading(<Code2 size={12} />, t('embedHeading', lang))}
                {copyField(embedCode, t('embedHeading', lang))}
                <p className="mt-1 text-body-sm text-ink-2">{t('embedHint', lang)}</p>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
