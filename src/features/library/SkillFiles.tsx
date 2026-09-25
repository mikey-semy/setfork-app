'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, FileCode, FileText, Folder, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'
import { IconButton } from '@/shared/ui/IconButton'
import { TextButton } from '@/shared/ui/TextButton'
import { MenuItem } from '@/shared/ui/MenuItem'
import { CodeSurface } from '@/shared/ui/CodeSurface'
import type { CodeToken } from '@/shared/ui/highlight-code'
import { buttonClass } from '@/shared/ui/button-style'
import { Tooltip } from '@/shared/ui/Tooltip'

export interface SkillFileRow {
  path: string
  executable: boolean
  bytes: number
}

const DIRS = ['scripts', 'references', 'assets'] as const

function size(n: number): string {
  if (n < 1024) return `${n} B`
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Открытый файл: строки уже подсвечены на сервере (`/blob?format=lines`). */
type Opened = { path: string; state: 'loading' } | { path: string; state: 'failed' } | { path: string; state: 'ready'; code: string; language: string | null; lines: CodeToken[][] }

/**
 * ФАЙЛЫ СКИЛЛА — проводником в блоке, как дерево файлов у GitHub.
 *
 * Мы про списки: файлы — приложение к ним, поэтому это не обозреватель кода во всю
 * страницу, а один блок под списком — папки `scripts/`, `references/`, `assets/` и их
 * файлы с размером. Текст открывается по щелчку тут же (`blob`), а не едет в страницу:
 * набор бывает до мегабайта.
 *
 * ⚠️ ФАЙЛ РАСКРЫВАЕТСЯ ПОД СВОЕЙ СТРОКОЙ, а не внизу блока. Раньше просмотр вставал
 * под всем деревом: у скилла на 26 файлов щелчок по первому открывал текст экраном
 * ниже, и было не понять, открылся ли он вообще (замечание владельца 25.09). Под
 * строкой — как раскрытие в дереве: видно, что и где открыто; повторный щелчок
 * сворачивает. Показ — тем же блоком кода, что в списках (CodeSurface: подсветка,
 * номера строк, перенос, копирование), а не голым <pre>.
 */
export function SkillFiles({ files, base, version, lang }: { files: SkillFileRow[]; base: string; version: number; lang: Lang }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState<Opened | null>(null)
  if (!files.length) return null

  const blobHref = (path: string, lines = false) =>
    `${base}/blob?${new URLSearchParams({ path, v: String(version), ...(lines ? { format: 'lines' } : {}) })}`
  const show = async (path: string) => {
    setOpen({ path, state: 'loading' })
    try {
      const res = await fetch(blobHref(path, true))
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { code: string; language: string | null; lines: CodeToken[][] }
      setOpen((cur) => (cur?.path === path ? { path, state: 'ready', ...data } : cur))
    } catch {
      setOpen((cur) => (cur?.path === path ? { path, state: 'failed' } : cur))
    }
  }
  const toggle = (path: string) => (open?.path === path ? setOpen(null) : void show(path))

  const viewer = (o: Opened) => (
    <div className="border-t border-border bg-surface-2">
      {o.state === 'failed' ? (
        <p className="px-3 py-2 text-body-sm text-danger" role="alert">
          {t('skillFileFailed', lang)}{' '}
          <TextButton tone="accent" onClick={() => show(o.path)}>
            {t('tryAgain', lang)}
          </TextButton>
        </p>
      ) : o.state === 'loading' ? (
        <p className="px-3 py-2 text-body-sm text-muted" role="status">
          {t('skillFileLoading', lang)}
        </p>
      ) : (
        // Высота ограничена: файл бывает в тысячи строк, а под ним — остальное дерево.
        <div className="cap-screen overflow-y-auto">
          <CodeSurface
            code={o.code}
            label={o.language ?? o.path.slice(o.path.lastIndexOf('.') + 1)}
            lines={o.lines}
            lang={lang}
            actions={
              <>
                <Tooltip label={t('skillFileRaw', lang)}>
                  <a
                    href={blobHref(o.path)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('skillFileRaw', lang)}
                    className={buttonClass({ variant: 'ghost', size: 'sm', className: 'px-1.5' })}
                  >
                    <ExternalLink size={14} />
                  </a>
                </Tooltip>
                <IconButton size="sm" variant="ghost" label={t('close', lang)} onClick={() => setOpen(null)}>
                  <X size={14} />
                </IconButton>
              </>
            }
          />
        </div>
      )}
    </div>
  )

  return (
    <section aria-labelledby="skill-files" className={`${cardClass({ pad: 'none' })} overflow-hidden print:hidden`}>
      <h2 id="skill-files" className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2 text-body-sm font-semibold text-ink">
        <span>{t('skillFilesTitle', lang)}</span>
        <span className="font-normal text-muted">{t('skillFilesCount', lang).replace('{n}', String(files.length))}</span>
      </h2>
      <ul className="divide-y divide-border">
        {DIRS.map((dir) => {
          const inDir = files.filter((f) => f.path.startsWith(`${dir}/`))
          if (!inDir.length) return null
          const isClosed = closed[dir]
          return (
            <li key={dir}>
              <MenuItem aria-expanded={!isClosed} onClick={() => setClosed((c) => ({ ...c, [dir]: !c[dir] }))} className="rounded-none text-ink">
                {isClosed ? <ChevronRight size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                <Folder size={14} className="text-accent" />
                <span className="font-medium">{dir}</span>
              </MenuItem>
              {!isClosed && (
                <ul className="divide-y divide-border/60">
                  {inDir.map((f) => {
                    const name = f.path.slice(dir.length + 1)
                    const isOpen = open?.path === f.path
                    return (
                      <li key={f.path}>
                        <MenuItem
                          onClick={() => toggle(f.path)}
                          active={isOpen}
                          aria-expanded={isOpen}
                          className="min-w-0 rounded-none pl-10"
                        >
                          {f.executable ? <FileCode size={14} className="shrink-0 text-muted" /> : <FileText size={14} className="shrink-0 text-muted" />}
                          <span className="min-w-0 flex-1 truncate font-mono text-ink">{name}</span>
                          {f.executable ? <span className="shrink-0 rounded border border-border px-1 text-caption text-muted">755</span> : null}
                          <span className="shrink-0 font-mono text-caption text-muted">{size(f.bytes)}</span>
                        </MenuItem>
                        {isOpen && open ? viewer(open) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
