import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { TagInput } from '@/shared/ui/TagInput'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { ListTypeToggle } from './ListTypeToggle'
import { updateListMeta } from './actions'

const card = 'rounded-lg border border-border bg-surface p-5'
const label = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

/** Настройки списка → Основное: название / описание / теги / порядок.
 *  Видимость переехала в Опасную зону (как «Change visibility» на GitHub).
 *  slug НЕ редактируется (техническая авто-вещь). */
export function GeneralSection({
  templateId,
  title,
  desc,
  tags,
  ordered,
  lang,
}: {
  templateId: string
  title: LocaleText
  desc: LocaleText
  tags: string[]
  ordered: boolean
  lang: Lang
}) {
  const save = updateListMeta.bind(null, templateId)

  return (
    <section className={card}>
      <div className="mb-4 font-semibold text-ink">{t('generalTitle', lang)}</div>

      <form action={save} className="flex flex-col gap-4">
        <div>
          <label className={label} htmlFor="ls-title">{t('listTitle', lang)}</label>
          <Input id="ls-title" name="title" defaultValue={tr(title, lang)} required maxLength={140} />
        </div>
        <div>
          <label className={label} htmlFor="ls-desc">{t('listDesc', lang)}</label>
          <Textarea id="ls-desc" name="desc" defaultValue={tr(desc, lang)} rows={3} maxLength={500} className="resize-y" />
        </div>
        <div>
          <label className={label}>{t('tags', lang)}</label>
          <TagInput initial={tags} lang={lang} />
        </div>

        <div>
          <span className={label}>{t('listKind', lang)}</span>
          <ListTypeToggle ordered={ordered} lang={lang} />
        </div>

        <div>
          <SubmitButton>
            {t('saveChanges', lang)}
          </SubmitButton>
        </div>
      </form>
    </section>
  )
}
