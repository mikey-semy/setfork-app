'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, FileCode, FileText, Folder, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'
import { IconButton } from '@/shared/ui/IconButton'
import { TextButton } from '@/shared/ui/TextButton'
import { MenuItem } from '@/shared/ui/MenuItem'

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

/**
 * ФАЙЛЫ СКИЛЛА — проводником в блоке, как дерево файлов у GitHub.
 *
 * Мы про списки: файлы — приложение к ним, поэтому это не обозреватель кода во всю
 * страницу, а один блок под списком — папки `scripts/`, `references/`, `assets/` и их
 * файлы с размером. Текст открывается по щелчку тут же (`blob`), а не едет в страницу:
 * набор бывает до мегабайта.
 */
export function SkillFiles({ files, base, version, lang }: { files: SkillFileRow[]; base: string; version: number; lang: Lang }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState<{ path: string; text: string | null; failed?: boolean } | null>(null)
  if (!files.length) return null

  const blobHref = (path: string) => `${base}/blob?${new URLSearchParams({ path, v: String(version) })}`
  const show = async (path: string) => {
    setOpen({ path, text: null })
    try {
      const res = await fetch(blobHref(path))
      if (!res.ok) throw new Error(String(res.status))
      setOpen({ path, text: await res.text() })
    } catch {
      setOpen({ path, text: null, failed: true })
    }
  }

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
                    return (
                      <li key={f.path}>
                        <MenuItem
                          onClick={() => show(f.path)}
                          active={open?.path === f.path}
                          aria-current={open?.path === f.path ? 'true' : undefined}
                          className="min-w-0 rounded-none pl-10"
                        >
                          {f.executable ? <FileCode size={14} className="shrink-0 text-muted" /> : <FileText size={14} className="shrink-0 text-muted" />}
                          <span className="min-w-0 flex-1 truncate font-mono text-ink">{name}</span>
                          {f.executable ? <span className="shrink-0 rounded border border-border px-1 text-caption text-muted">755</span> : null}
                          <span className="shrink-0 font-mono text-caption text-muted">{size(f.bytes)}</span>
                        </MenuItem>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {open && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between gap-2 bg-surface-2 px-3 py-1.5">
            <a href={blobHref(open.path)} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-body-sm text-accent hover:underline">
              {open.path}
            </a>
            <IconButton size="sm" variant="ghost" label={t('close', lang)} onClick={() => setOpen(null)}>
              <X size={14} />
            </IconButton>
          </div>
          {open.failed ? (
            <p className="px-3 py-2 text-body-sm text-danger">
              {t('skillFileFailed', lang)}{' '}
              <TextButton tone="accent" onClick={() => show(open.path)}>
                {t('tryAgain', lang)}
              </TextButton>
            </p>
          ) : (
            <pre className="max-h-96 overflow-auto px-3 py-2 font-mono text-caption leading-relaxed text-ink">{open.text ?? '…'}</pre>
          )}
        </div>
      )}
    </section>
  )
}
