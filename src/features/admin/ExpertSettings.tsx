'use client'

// Настройки ОДНОГО специалиста — форма, вынесенная из зала совета на его страницу.
// Причина переезда: двадцать таких форм на одной странице были стеной, в которой нельзя ни
// найти нужного, ни увидеть состав. У списка настройки на странице списка — здесь так же.
// Файл не переписан, а перенесён: поведение формы уже выстрадано (аватар не в форме, чтобы
// устаревшее значение не затирало свежую картинку, и т.д.).

import { useState, useTransition } from 'react'
import { BarChart3, Check } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/IconButton'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { TagInput } from '@/shared/ui/TagInput'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Field } from '@/shared/ui/Field'
import { ModelSelect, NONE, type Option } from './ModelSelect'
import { resetExpertAvatar, saveExpert, setExpertAvatar, uploadExpertAvatar } from './actions'
import { t, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * Менеджер ростера совета: кто такие эксперты, как их зовут, чем они думают.
 * Раньше это была константа в коде — правилось только деплоем.
 *
 * id не редактируется и не удаляется: он же имя встроенной аватарки и значение who в истории
 * бесед. Переименование осиротило бы картинку и прошлые беседы — поэтому меняют имя, а выключают
 * флагом. По той же причине форма у каждого эксперта своя: сохранять весь ростер одним куском
 * значит перетирать чужие правки целиком.
 */

export interface ExpertRow {
  id: string
  /** URL своей картинки (если загружена) — иначе рисуем встроенную по avatar. */
  uploadedUrl?: string
  avatarUploaded: boolean
  nameRu: string
  nameEn: string
  /** Профессия отдельно от имени — уезжает в профиль как должность. */
  professionRu: string
  professionEn: string
  /** Тир мастерства по профессии (джун/мидл/сеньор, commis→шеф). Пусто = плоская. */
  tier: string
  /** Карьера: active → dormant → archived (архив обратим). */
  lifecycle: 'active' | 'idle' | 'dormant' | 'archived'
  /** «Чего не хватает» — сигнал в фиче-бэклог владельца. */
  dreams: string
  persona: string
  guildRu: string
  guildEn: string
  code: string
  lens: string
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
  lang,
}: {
  id: string
  value: string
  uploadedUrl?: string
  gallery: string[]
  lang: Lang
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
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
    <div className="relative shrink-0">
      <Tooltip label={t('admin.change', lang)}>
        <button type="button" onClick={() => setOpen((v) => !v)} className="relative block">
          <GnomeAvatar src={src} size={64} className="size-16 rounded-full object-cover ring-1 ring-border hover:ring-(--accent)" />
          {busy && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50">
              <Spinner size="lg" className="text-white" />
            </span>
          )}
        </button>
      </Tooltip>
      {open && (
        <div className={cardClass({ pad: 'xs', className: 'absolute left-0 top-full z-20 mt-2 w-[14.5rem] shadow-card' })}>
          <div className="grid max-h-[8.5rem] grid-cols-6 gap-1 overflow-y-auto">
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
            <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-[0.6875rem] text-ink-2 hover:text-ink">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload(f)
                }}
              />
              {t('admin.uploadOwn', lang)}
            </label>
            {uploadedUrl && (
              <button
                type="button"
                onClick={() => void resetExpertAvatar(id)}
                className="text-[0.6875rem] text-muted hover:text-ink"
              >
                {t('admin.reset2', lang)}
              </button>
            )}
          </div>
          {err && <p className="mt-1 text-[0.6875rem] text-danger">{err}</p>}
        </div>
      )}
    </div>
  )
}

function ExpertCard({ e, modelOptions, gallery, lang }: { e: ExpertRow; modelOptions: Option[]; gallery: string[]; lang: Lang }) {
  const ru = lang === 'ru'
  const [pending, start] = useTransition()
  const [enabled, setEnabled] = useState(e.enabled)
  const [anyTopic, setAnyTopic] = useState(e.domains.includes('*'))
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
      className={cardClass({ tone: 'inset', pad: 'sm', className: enabled ? '' : 'opacity-60' })}
    >
      {/* Аватарки в форме НЕТ: ею владеют setExpertAvatar/upload/reset. Иначе форма со своим
          устаревшим значением затирала бы только что загруженную картинку — и на «вернуть
          встроенную» экран строил путь из S3-ключа, показывая битую картинку. */}
      <input type="hidden" name="id" value={e.id} />

      {/* Аватар — в ОДНОЙ строке с id/страницей/тумблером, не отдельной колонкой слева
          (иначе под аватаром пустота, а поля уезжали вправо — фидбек владельца). Поля ниже
          во всю ширину карточки. */}
      <div className="mb-3 flex items-center gap-2">
        <AvatarPicker id={e.id} value={e.avatarUploaded ? e.id : e.avatar || e.id} uploadedUrl={e.uploadedUrl} gallery={gallery} lang={lang} />
        <Tooltip label={t('admin.idFixedAvatarName', lang)}>
          <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">
            {e.id}
          </code>
        </Tooltip>
        <Tooltip label={t('admin.personalPageKpiKnowledge', lang)}>
          <IconButton href={`/admin/council/${e.id}`} size="xs" variant="ghost" label={t('admin.personalPage', lang)}>
            <BarChart3 size={13} />
          </IconButton>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[0.6875rem] text-muted">{t('admin.on2', lang)}</span>
          <Switch name="enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('admin.nameRu', lang)}>
              <Input name="nameRu" defaultValue={e.nameRu} />
            </Field>
            <Field label={t('admin.nameEn', lang)}>
              <Input name="nameEn" defaultValue={e.nameEn} />
            </Field>
          </div>

          {/* Профессия ОТДЕЛЬНО от имени: имя своё (мифологическое), профессия буквальная
              и показывается в профиле аккаунта как должность. */}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('admin.professionRu', lang)}>
              <Input name="professionRu" defaultValue={e.professionRu} placeholder={t('admin.chef', lang)} />
            </Field>
            <Field label={t('admin.professionEn', lang)}>
              <Input name="professionEn" defaultValue={e.professionEn} placeholder="Chef" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t('admin.tier', lang)}>
              <Input name="tier" defaultValue={e.tier} placeholder={t('admin.senior', lang)} />
            </Field>
            <Field label={t('admin.career', lang)}>
              {/* Стадии ставит и петля (по бездействию: в строю → под риском → спит), и человек
                  здесь же. «Под риском» — рабочая стадия: такой специалист идёт ПЕРВЫМ в очереди
                  на работу, чтобы вернуться в строй. Спящих совет не созывает, но петля будит
                  их, когда их ремесло больше некому закрыть. Архив ставит только человек. */}
              <Select name="lifecycle" defaultValue={e.lifecycle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('admin.active2', lang)}</SelectItem>
                  <SelectItem value="idle">{t('admin.atRiskNoWork', lang)}</SelectItem>
                  <SelectItem value="dormant">{t('admin.dormant', lang)}</SelectItem>
                  <SelectItem value="archived">{t('admin.archived', lang)}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t('admin.guildRu', lang)}>
              <Input name="guildRu" defaultValue={e.guildRu} />
            </Field>
            <Field label={t('admin.guildEn', lang)}>
              <Input name="guildEn" defaultValue={e.guildEn} />
            </Field>
          </div>

          <Field label={t('admin.guildCodeQualityStandards', lang)}>
            <Textarea name="code" defaultValue={e.code} rows={4} className="resize-y font-mono text-[0.78125rem] leading-[1.45]" />
          </Field>

          <Field label={t('admin.queryLensAspectsHe', lang)}>
            <Input name="lens" defaultValue={e.lens} className="font-mono text-[0.78125rem]" />
          </Field>

          <Field label={t('admin.instructionPersona', lang)}>
            <Textarea name="persona" defaultValue={e.persona} rows={7} className="resize-y leading-[1.45]" />
          </Field>

          {/* «Мечты» — что мешает работать; это сигнал в фиче-бэклог, а не служебная заметка. */}
          <Field label={t('admin.whatSMissingGoes', lang)}>
            <Textarea
              name="dreams"
              defaultValue={e.dreams}
              rows={2}
              className="resize-y leading-[1.45]"
              placeholder={t('admin.aStepTimerRecipes', lang)}
            />
          </Field>

          {/* htmlFor (а не оборачивание в label): внутри уже есть label тумблера — вложенные
              label невалидны, а связывать подпись группы с одним из контролов нечестно. */}
          <Field label={t('admin.domainsWhatExpertSummoned', lang)} htmlFor={`domains-${e.id}`}>
            {/* Домены — те же теги по смыслу, поэтому тот же TagInput: чипы, автокомплит из реестра.
                «Любая тема» отдельным тумблером, а не доменом «*»: normalize у TagInput вырезает
                звёздочку, да и тумблер честнее магического символа. */}
            <label className="mb-1.5 flex items-center gap-2 text-[0.78125rem] text-ink-2">
              <Switch name="anyTopic" checked={anyTopic} onCheckedChange={setAnyTopic} />
              {t('admin.anyTopicGeneralist', lang)}
            </label>
            {anyTopic ? null : <TagInput name="domains" initial={e.domains.filter((d) => d !== '*')} lang={ru ? 'ru' : 'en'} max={12} />}
          </Field>

          <Field label={t('admin.modelEmptyFromCouncil', lang)} htmlFor={`model-${e.id}`}>
            <ModelSelect id={`model-${e.id}`} name="model" defaultValue={e.model} options={modelOptions} allowEmpty placeholder="—" allowCustom customHint={t('admin.use', lang)} ru={lang === 'ru'} />
          </Field>

          <div className="flex items-center justify-between gap-3 pt-0.5">
            <label className="flex items-center gap-2 text-[0.78125rem] text-ink-2">
              <Switch name="online" checked={online} onCheckedChange={setOnline} />
              {t('admin.webAccessOnlinePricier', lang)}
            </label>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? <Spinner size="sm" /> : saved ? <Check size={13} /> : null}
              {saved ? t('admin.saved', lang) : t('common.save', lang)}
            </Button>
          </div>
        </div>
    </form>
  )
}

export function ExpertSettings({ e, modelOptions, gallery, lang }: { e: ExpertRow; modelOptions: Option[]; gallery: string[]; lang: Lang }) {
  return <ExpertCard e={e} modelOptions={modelOptions} gallery={gallery} lang={lang} />
}

export { NONE }
