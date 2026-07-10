import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { updateListMeta, setListVisibility } from './actions'

const card = 'rounded-lg border border-border bg-surface p-5'
const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-ink outline-none focus:border-border-strong'
const label = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

/** Настройки списка → Основное: название / описание / теги / порядок + видимость.
 *  slug НЕ редактируется (техническая авто-вещь). */
export function GeneralSection({
  templateId,
  title,
  desc,
  tags,
  ordered,
  visibility,
  lang,
}: {
  templateId: string
  title: LocaleText
  desc: LocaleText
  tags: string[]
  ordered: boolean
  visibility: 'public' | 'private'
  lang: Lang
}) {
  const save = updateListMeta.bind(null, templateId)
  const toggleVisibility = setListVisibility.bind(null, templateId, visibility === 'public' ? 'private' : 'public')

  return (
    <section className={card}>
      <div className="mb-4 font-semibold text-ink">{t('generalTitle', lang)}</div>

      <form action={save} className="flex flex-col gap-4">
        <div>
          <label className={label} htmlFor="ls-title">{t('listTitle', lang)}</label>
          <input id="ls-title" name="title" defaultValue={tr(title, lang)} required maxLength={140} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="ls-desc">{t('listDesc', lang)}</label>
          <textarea id="ls-desc" name="desc" defaultValue={tr(desc, lang)} rows={3} maxLength={500} className={`${field} resize-y`} />
        </div>
        <div>
          <label className={label} htmlFor="ls-tags">{t('tags', lang)}</label>
          <input id="ls-tags" name="tags" defaultValue={tags.join(' ')} placeholder={t('tagsHint', lang)} className={field} />
        </div>

        <fieldset>
          <legend className={label}>{t('listKind', lang)}</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-[:checked]:border-accent">
              <input type="radio" name="ordered" value="ordered" defaultChecked={ordered} className="mt-0.5" />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{t('orderedLabel', lang)}</span>
                <span className="block text-[12px] text-ink-2">{t('orderedHint', lang)}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-[:checked]:border-accent">
              <input type="radio" name="ordered" value="unordered" defaultChecked={!ordered} className="mt-0.5" />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{t('unorderedLabel', lang)}</span>
                <span className="block text-[12px] text-ink-2">{t('unorderedHint', lang)}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <div>
          <SubmitButton className="rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-fg">
            {t('saveChanges', lang)}
          </SubmitButton>
        </div>
      </form>

      {/* Видимость — на видном месте (не в danger). */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          <div className="text-[13.5px] font-medium text-ink">
            {t('visibility', lang)}: {t(visibility === 'public' ? 'publicLabel' : 'privateLabel', lang)}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-2">
            {t(visibility === 'public' ? 'publicHint' : 'privateHint', lang)}
          </div>
        </div>
        <form action={toggleVisibility}>
          <SubmitButton className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-ink hover:border-border-strong">
            {t(visibility === 'public' ? 'makePrivate' : 'makePublic', lang)}
          </SubmitButton>
        </form>
      </div>
    </section>
  )
}
