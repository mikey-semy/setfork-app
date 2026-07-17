'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { ModelSelect, NONE, type Option } from './ModelSelect'
import { resetExpertAvatar, saveExpert, setExpertAvatar, uploadExpertAvatar } from './actions'

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
  /** URL своей картинки (если загружена) — иначе рисуем встроенную по avatar. */
  uploadedUrl?: string
  avatarUploaded: boolean
  nameRu: string
  nameEn: string
  persona: string
  domains: string[]
  model: string
  avatar: string
  online: boolean
  enabled: boolean
}

/**
 * Аватарка: галерея встроенных (40 нарезанных, public/gnomes) ИЛИ своя картинка.
 * Загрузка идёт отдельным действием, а не полем формы: файл сохраняется сразу и живёт в S3/на
 * диске — держать его в общей форме значило бы заливать заново на каждое «Сохранить».
 */
function AvatarPicker({
  id,
  value,
  uploadedUrl,
  gallery,
  ru,
}: {
  id: string
  value: string
  uploadedUrl?: string
  gallery: string[]
  ru: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const src = uploadedUrl || `/gnomes/${value}.webp`

  const upload = async (file: File) => {
    setBusy(true)
    setErr('')
    const fd = new FormData()
    fd.set('id', id)
    fd.set('file', file)
    const res = await uploadExpertAvatar(fd)
    setBusy(false)
    if ('error' in res) setErr(res.error)
    else setOpen(false)
  }

  return (
    <div className="shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="relative block" title={say('Change', 'Сменить')}>
        <GnomeAvatar src={src} size={64} className="size-16 rounded-full object-cover ring-1 ring-border hover:ring-(--accent)" />
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50">
            <Loader2 size={16} className="animate-spin text-white" />
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 w-[232px] rounded-md border border-border bg-surface p-1.5">
          <div className="grid max-h-[136px] grid-cols-6 gap-1 overflow-y-auto">
            {gallery.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  void setExpertAvatar(id, g)
                  setOpen(false)
                }}
                className={`rounded-full ${!uploadedUrl && g === value ? 'ring-2 ring-(--accent)' : 'hover:ring-1 hover:ring-border-strong'}`}
              >
                <GnomeAvatar src={`/gnomes/${g}.webp`} size={32} className="size-8 rounded-full" />
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-2 border-t border-border pt-1.5">
            <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-[11.5px] text-ink-2 hover:text-ink">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload(f)
                }}
              />
              {say('Upload own', 'Загрузить свою')}
            </label>
            {uploadedUrl && (
              <button
                type="button"
                onClick={() => void resetExpertAvatar(id)}
                className="text-[11.5px] text-muted hover:text-ink"
              >
                {say('Reset', 'Вернуть встроенную')}
              </button>
            )}
          </div>
          {err && <p className="mt-1 text-[11px] text-danger">{err}</p>}
        </div>
      )}
    </div>
  )
}

function ExpertCard({ e, modelOptions, gallery, ru }: { e: ExpertRow; modelOptions: Option[]; gallery: string[]; ru: boolean }) {
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  const [pending, start] = useTransition()
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
      {/* Аватарки в форме НЕТ: ею владеют setExpertAvatar/upload/reset. Иначе форма со своим
          устаревшим значением затирала бы только что загруженную картинку — и на «вернуть
          встроенную» экран строил путь из S3-ключа, показывая битую картинку. */}
      <input type="hidden" name="id" value={e.id} />

      <div className="flex gap-3">
        <AvatarPicker id={e.id} value={e.avatarUploaded ? e.id : e.avatar || e.id} uploadedUrl={e.uploadedUrl} gallery={gallery} ru={ru} />

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
            <textarea name="persona" defaultValue={e.persona} rows={7} className={`${field} resize-y leading-[1.45]`} />
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
  return (
    // Сетка, а не колонка: у эксперта инструкция в несколько строк, и списком они уходили в
    // бесконечность. Пояснение к разделу живёт на странице — здесь бы оно дублировалось.
    <div className="grid items-start gap-3 xl:grid-cols-2 min-[1800px]:grid-cols-3">
      {experts.map((e) => (
        <ExpertCard key={e.id} e={e} modelOptions={modelOptions} gallery={gallery} ru={ru} />
      ))}
    </div>
  )
}

export { NONE }
