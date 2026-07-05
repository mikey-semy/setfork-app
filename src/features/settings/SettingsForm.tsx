'use client'

import { useActionState, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import type { Social } from '@/shared/db/schema'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { AvatarDropzone } from './AvatarDropzone'
import { SOCIAL_TYPES, SocialIcon } from './socials'
import { updateProfile, type ActionResult } from './actions'

// Поля настроек чуть крупнее стандартного md (px-3, text-14) — доводка поверх примитивов.
const field = 'px-3 py-2 text-[14px]'
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
        <Input name="name" defaultValue={name} maxLength={80} className={field} />
      </div>

      <div>
        <label className={lbl}>{t('bio', lang)}</label>
        <Textarea
          name="bio"
          defaultValue={bio}
          maxLength={280}
          rows={2}
          placeholder={t('bioPh', lang)}
          className={`${field} min-h-[39px] max-h-[81px] resize-y overflow-y-auto`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>{t('location', lang)}</label>
          <Input name="location" defaultValue={location} maxLength={80} placeholder={t('locationPh', lang)} className={field} />
        </div>
        <div>
          <label className={lbl}>{t('website', lang)}</label>
          <Input name="website" defaultValue={website} maxLength={200} placeholder="example.com" className={field} />
        </div>
      </div>

      {/* Socials */}
      <div>
        <label className={lbl}>{t('socials', lang)}</label>
        <input type="hidden" name="socials" value={JSON.stringify(rows.filter((r) => r.url.trim()))} />
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={row.type} onValueChange={(v) => setRow(i, { type: v })}>
                <SelectTrigger className="w-[160px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOCIAL_TYPES.map((s) => (
                    <SelectItem key={s.type} value={s.type}>
                      <span className="flex items-center gap-2">
                        <SocialIcon type={s.type} className="shrink-0 text-ink-2" />
                        {s.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={row.url}
                onChange={(e) => setRow(i, { url: e.target.value })}
                placeholder="https://…"
                className={field}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => removeRow(i)}
                aria-label="remove"
                className="h-[42px] w-[42px] shrink-0 border border-border p-0 text-muted hover:bg-transparent hover:text-ink"
              >
                <X size={15} />
              </Button>
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
        {state?.ok && <span className="text-[13px] text-ok">{t('profileSaved', lang)}</span>}
        {state?.error && <span className="text-[13px] text-danger">{state.error}</span>}
        <Button type="submit" variant="primary" disabled={pending} className="px-5 py-2.5 text-[14px] disabled:opacity-60">
          {t('saveChanges', lang)}
        </Button>
      </div>
    </form>
  )
}
