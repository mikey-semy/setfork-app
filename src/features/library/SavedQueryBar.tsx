'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { TagInput } from '@/shared/ui/TagInput'
import { Field } from '@/shared/ui/Field'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { createSavedQuery, deleteSavedQuery } from './saved-queries-actions'
import type { SavedQuery } from './saved-queries'
import { t } from '@/shared/i18n'

/**
 * Чипы сохранённых запросов на /my-lists (HQ §11, Dataview-аналог): клик —
 * фильтр ленты (?sq=id), крестик — удалить, «+" — Popover-форма (shadcn:
 * Input/TagInput/Select — по правилу проекта, без браузерных контролов).
 */
export function SavedQueryBar({ queries, active, lang }: { queries: SavedQuery[]; active?: string; lang: Lang }) {  const [pending, start] = useTransition()

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {queries.map((q) => {
        const isActive = q.id === active
        return (
          <span
            key={q.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.78125rem] ${
              isActive ? 'border-(--accent) bg-(--accent-soft) text-accent' : 'border-border text-ink-2 hover:text-ink'
            }`}
          >
            <Link href={isActive ? '/my-lists' : `/my-lists?sq=${q.id}`}>{q.name}</Link>
            <button
              type="button"
              aria-label={t('library.deleteQuery', lang)}
              disabled={pending}
              onClick={() => start(() => deleteSavedQuery(q.id))}
              className="grid size-4 place-items-center rounded-full text-muted hover:text-danger"
            >
              <X size={10} />
            </button>
          </span>
        )
      })}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs">
            <Plus size={13} /> {t('library.query', lang)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[17.5rem]">
          <form action={createSavedQuery} className="space-y-2.5">
            <Field label={t('library.name', lang)}>
              <Input name="name" required maxLength={60} placeholder={t('library.booksIStarted', lang)} />
            </Field>
            {/* htmlFor: внутри TagInput чипы с кнопками удаления — оборачивание в label ловило бы их клики. */}
            <Field label={t('library.tagsAny', lang)} htmlFor="sq-tags">
              <TagInput initial={[]} lang={lang} />
            </Field>
            <Field label={t('library.myRun', lang)}>
              <Select name="runState" defaultValue="any">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('library.any', lang)}</SelectItem>
                  <SelectItem value="started">{t('library.started', lang)}</SelectItem>
                  <SelectItem value="done">{t('library.completed', lang)}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" size="sm" className="w-full">
              {t('library.saveQuery', lang)}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
