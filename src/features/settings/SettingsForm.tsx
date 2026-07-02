'use client'

import { useActionState, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import type { Social } from '@/shared/db/schema'
import { AvatarDropzone } from './AvatarDropzone'
import { SOCIAL_TYPES } from './socials'
import { updateProfile, type ActionResult } from './actions'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-border-strong'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

export function SettingsForm({
  lang,
  handle,
  name,
  avatarUrl,
  bio,
  location,
  website,
  socials,
}: {
  lang: Lang
  handle: string
  name: string
  avatarUrl: string | null
  bio: string
  location: string
  website: string
  socials: Social[]
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateProfile, null)
  const [rows, setRows] = useState<Social[]>(socials.length ? socials : [])

  const addRow = () => setRows((r) => [...r, { type: 'github', url: '' }])
  const setRow = (i: number, patch: Partial<Social>) => setRows((r) => r.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i))

  return (
    <form action={action} className="flex flex-col gap-5">
      <AvatarDropzone handle={handle} avatarUrl={avatarUrl} lang={lang} />

      <div>
        <label className={lbl}>{t('displayName', lang)}</label>
        <input name="name" defaultValue={name} maxLength={80} className={field} />
      </div>

      <div>
        <label className={lbl}>{t('bio', lang)}</label>
        <textarea name="bio" defaultValue={bio} maxLength={280} rows={3} placeholder={t('bioPh', lang)} className={`${field} resize-y`} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>{t('location', lang)}</label>
          <input name="location" defaultValue={location} maxLength={80} placeholder={t('locationPh', lang)} className={field} />
        </div>
        <div>
          <label className={lbl}>{t('website', lang)}</label>
          <input name="website" defaultValue={website} maxLength={200} placeholder="example.com" className={field} />
        </div>
      </div>

      {/* Socials */}
      <div>
        <label className={lbl}>{t('socials', lang)}</label>
        <input type="hidden" name="socials" value={JSON.stringify(rows.filter((r) => r.url.trim()))} />
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={row.type}
                onChange={(e) => setRow(i, { type: e.target.value })}
                className="w-[140px] shrink-0 rounded-md border border-border bg-surface-2 px-2 py-2 text-[13px] text-ink outline-none focus:border-border-strong"
              >
                {SOCIAL_TYPES.map((s) => (
                  <option key={s.type} value={s.type}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                value={row.url}
                onChange={(e) => setRow(i, { url: e.target.value })}
                placeholder="https://…"
                className={field}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="remove"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-muted hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
          >
            <Plus size={14} /> {t('addSocial', lang)}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        {state?.ok && <span className="text-[13px] text-[var(--ok)]">{t('profileSaved', lang)}</span>}
        {state?.error && <span className="text-[13px] text-[var(--danger)]">{state.error}</span>}
        <button
          disabled={pending}
          className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg disabled:opacity-60"
        >
          {t('saveChanges', lang)}
        </button>
      </div>
    </form>
  )
}
