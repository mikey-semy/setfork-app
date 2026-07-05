'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, GitBranch, ChevronDown } from 'lucide-react'
import type { GitBranch as Branch } from '@/core'
import type { Lang } from '@/shared/i18n'

/** Селектор веток (как GitHub branch-picker) в version-bar. Выбор → ?ref=<branch>. */
export function BranchPicker({
  base,
  branches,
  current,
  lang,
}: {
  base: string
  branches: Branch[]
  current: string // активная ветка ('main' = дефолт)
  lang: Lang
}) {
  const ru = lang === 'ru'
  const [open, setOpen] = useState(false)
  if (branches.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-border-strong"
        title={ru ? 'Ветки' : 'Branches'}
      >
        <GitBranch size={13} className="text-muted" />
        <span className="max-w-[140px] truncate">{current}</span>
        <ChevronDown size={12} className="text-muted" />
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 p-4 pt-24" onClick={() => setOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-[300px] max-w-full rounded-lg border border-border bg-surface p-1.5 shadow-card">
              <div className="px-2 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                {ru ? 'Ветки' : 'Branches'} <span className="font-mono">{branches.length}</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {branches.map((b) => {
                  const on = b.name === current
                  return (
                    <Link
                      key={b.name}
                      href={b.isDefault ? base : `${base}?ref=${encodeURIComponent(b.name)}`}
                      onClick={() => setOpen(false)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-ink hover:bg-surface-2"
                    >
                      <span className="grid w-4 place-items-center">{on && <Check size={13} className="text-accent" />}</span>
                      <span className="min-w-0 truncate">{b.name}</span>
                      {b.isDefault ? (
                        <span className="ml-auto rounded-full border border-border px-1.5 text-[10.5px] text-muted">default</span>
                      ) : (
                        <span className="ml-auto font-mono text-[10.5px] text-muted">
                          +{b.ahead}/-{b.behind}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
