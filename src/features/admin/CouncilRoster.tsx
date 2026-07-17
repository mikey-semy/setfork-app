'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { ModelSelect, NONE, type Option } from './ModelSelect'
import { saveExpert } from './actions'

/**
 * Менеджер ростера совета: кто такие эксперты, как их зовут, чем они думают.
 * Раньше это была константа в коде — правилось только деплоем.
 *
 * id не редактируется и не удаляется: он же имя встроенной аватарки и значение who в истории
 * бесед. Переименование осиротило бы картинку и прошлые беседы — поэтому меняют имя, а выключают
 * флагом. По той же причине форма у каждого эксперта своя: сохранять весь ростер одним куском
 * значит перетирать чужие правки целиком.
 */

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-hidden focus:border-border-strong'
const lbl = 'mb-1 block text-[11.5px] font-semibold text-ink-2'

export interface ExpertRow {
  id: string
  nameRu: string
  nameEn: string
  persona: string
  domains: string[]
  model: string
  avatar: string
  online: boolean
  enabled: boolean
}

/** Галерея встроенных персонажей: 40 нарезанных из листа (public/gnomes). */
function AvatarPicker({ value, onPick, gallery, ru }: { value: string; onPick: (v: string) => void; gallery: string[]; ru: boolean }) {
  const [open, setOpen] = useState(false)
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  return (
    <div className="shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="block" title={say('Change', 'Сменить')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/gnomes/${value}.webp`} alt="" width={64} height={64} className="size-16 rounded-full ring-1 ring-border hover:ring-(--accent)" />
      </button>
      {open && (
        <div className="mt-2 grid max-h-[168px] w-[232px] grid-cols-6 gap-1 overflow-y-auto rounded-md border border-border bg-surface p-1.5">
          {gallery.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                onPick(g)
                setOpen(false)
              }}
              className={`rounded-full ${g === value ? 'ring-2 ring-(--accent)' : 'hover:ring-1 hover:ring-border-strong'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/gnomes/${g}.webp`} alt="" width={32} height={32} className="size-8 rounded-full" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ExpertCard({ e, modelOptions, gallery, ru }: { e: ExpertRow; modelOptions: Option[]; gallery: string[]; ru: boolean }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [pending, start] = useTransition()
  const [avatar, setAvatar] = useState(e.avatar || e.id)
  const [enabled, setEnabled] = useState(e.enabled)
  const [online, setOnline] = useState(e.online)
  const [saved, setSaved] = useState(false)

  return (
    <form
      action={(fd) =>
        start(async () => {
          await saveExpert(fd)
          setSaved(true)
          setTimeout(() => setSaved(false), 1600)
        })
      }
      className={`rounded-md border border-border bg-surface-2 p-3 ${enabled ? '' : 'opacity-60'}`}
    >
      <input type="hidden" name="id" value={e.id} />
      <input type="hidden" name="avatar" value={avatar} />

      <div className="flex gap-3">
        <AvatarPicker value={avatar} onPick={setAvatar} gallery={gallery} ru={ru} />

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted" title={say('id is fixed: avatar name and who in past chats', 'id не меняется: имя аватарки и who в прошлых беседах')}>
              {e.id}
            </code>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[11.5px] text-muted">{say('On', 'Вкл')}</span>
              <Switch name="enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>{say('Name (RU)', 'Имя (RU)')}</label>
              <input name="nameRu" defaultValue={e.nameRu} className={field} />
            </div>
            <div>
              <label className={lbl}>{say('Name (EN)', 'Имя (EN)')}</label>
              <input name="nameEn" defaultValue={e.nameEn} className={field} />
            </div>
          </div>

          <div>
            <label className={lbl}>{say('Instruction (persona)', 'Инструкция (персона)')}</label>
            <textarea name="persona" defaultValue={e.persona} rows={2} className={`${field} resize-y`} />
          </div>

          <div>
            <label className={lbl}>{say('Domains (comma-separated; * = any topic)', 'Домены (через запятую; * = любая тема)')}</label>
            <input name="domains" defaultValue={e.domains.join(', ')} className={`${field} font-mono text-[12px]`} />
          </div>

          <div>
            <label className={lbl}>{say('Model (empty = from council pool)', 'Модель (пусто = из пула совета)')}</label>
            <ModelSelect name="model" defaultValue={e.model} options={modelOptions} allowEmpty placeholder="—" />
          </div>

          <div className="flex items-center justify-between gap-3 pt-0.5">
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <Switch name="online" checked={online} onCheckedChange={setOnline} />
              {say('Web access (:online) — pricier', 'Веб-доступ (:online) — дороже')}
            </label>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-fg disabled:opacity-50"
            >
              {pending ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
              {saved ? say('Saved', 'Сохранено') : say('Save', 'Сохранить')}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}

export function CouncilRoster({ experts, modelOptions, gallery, ru }: { experts: ExpertRow[]; modelOptions: Option[]; gallery: string[]; ru: boolean }) {
  const say = (en: string, rus: string) => (ru ? rus : en)
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">
        {say(
          'Who the council summons and how they think. The steward matches the topic to domains; a disabled expert is never summoned.',
          'Кого созывает совет и чем он думает. Распорядитель подбирает по доменам; выключенного эксперта не позовут.',
        )}
      </p>
      {experts.map((e) => (
        <ExpertCard key={e.id} e={e} modelOptions={modelOptions} gallery={gallery} ru={ru} />
      ))}
    </div>
  )
}

export { NONE }
