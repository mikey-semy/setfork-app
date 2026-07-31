'use client'

import { useActionState, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import type { Social } from '@/shared/db/schema'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Field } from '@/shared/ui/Field'
import { AvatarDropzone } from './AvatarDropzone'
import { SOCIAL_TYPES, SocialIcon } from './socials'
import { updateProfile, type ActionResult } from './actions'

// Строка соцсети редактируется (type/url меняются) и удаляется из середины списка,
// поэтому ни индекс, ни содержимое не годятся как key — генерируем id при создании строки.
type SocialRow = Social & { _k: number }

export function SettingsForm({
  lang,
  handle,
  name,
  avatarUrl,
  bio,
  location,
  website,
  socials,
  profilePrivate,
  avatarShape,
}: {
  lang: Lang
  handle: string
  name: string
  avatarUrl: string | null
  bio: string
  location: string
  website: string
  socials: Social[]
  profilePrivate: boolean
  avatarShape: 'circle' | 'square'
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateProfile, null)
  const [rows, setRows] = useState<SocialRow[]>(() => socials.map((s, i) => ({ ...s, _k: i })))
  const [priv, setPriv] = useState(profilePrivate)
  const [square, setSquare] = useState(avatarShape === 'square')
  const seq = useRef(socials.length)

  const addRow = () => {
    const k = seq.current++
    setRows((r) => [...r, { type: 'github', url: '', _k: k }])
  }
  const setRow = (i: number, patch: Partial<Social>) => setRows((r) => r.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i))

  return (
    <form action={action} className="flex flex-col gap-5">
      <AvatarDropzone handle={handle} avatarUrl={avatarUrl} lang={lang} square={square} />

      {/* Форма аватара в профиле — круг (по умолчанию) или квадрат. */}
      <label className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">{t('avatarSquareLabel', lang)}</span>
        <Switch name="avatarSquare" checked={square} onCheckedChange={setSquare} />
      </label>

      <Field label={t('displayName', lang)}>
        <Input name="name" defaultValue={name} maxLength={80} />
      </Field>

      <Field label={t('bio', lang)}>
        <Textarea
          name="bio"
          defaultValue={bio}
          maxLength={280}
          rows={2}
          placeholder={t('bioPh', lang)}
          className="min-h-[39px] max-h-[81px] resize-y overflow-y-auto"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('location', lang)}>
          <Input name="location" defaultValue={location} maxLength={80} placeholder={t('locationPh', lang)} />
        </Field>
        <Field label={t('website', lang)}>
          <Input name="website" defaultValue={website} maxLength={200} placeholder="example.com" />
        </Field>
      </div>

      {/* Socials: htmlFor — внутри строки с кнопками, оборачивание в label ловило бы их клики. */}
      <Field label={t('socials', lang)} htmlFor="profile-socials">
        <input type="hidden" name="socials" value={JSON.stringify(rows.flatMap((r) => (r.url.trim() ? [{ type: r.type, url: r.url }] : [])))} />
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={row._k} className="flex items-center gap-2">
              <Select value={row.type} onValueChange={(v) => setRow(i, { type: v })}>
                <SelectTrigger id={i === 0 ? 'profile-socials' : undefined} className="w-[160px] shrink-0">
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
      </Field>

      {/* Приватность профиля */}
      <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">{t('profilePrivateLabel', lang)}</div>
          <p className="mt-0.5 max-w-[520px] text-[12px] text-ink-2">{t('profilePrivateHint', lang)}</p>
        </div>
        <Switch name="profilePrivate" checked={priv} onCheckedChange={setPriv} />
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
