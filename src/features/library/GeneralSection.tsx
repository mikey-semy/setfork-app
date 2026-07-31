import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { TagInput } from '@/shared/ui/TagInput'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Field } from '@/shared/ui/Field'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { ListTypeToggle } from './ListTypeToggle'
import { updateListMeta } from './actions'

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
    <SettingsSection title={t('generalTitle', lang)}>
      <form action={save} className="flex flex-col gap-4">
        <Field label={t('listTitle', lang)}>
          <Input name="title" defaultValue={tr(title, lang)} required maxLength={140} />
        </Field>
        <Field label={t('listDesc', lang)}>
          <Textarea name="desc" defaultValue={tr(desc, lang)} rows={3} maxLength={500} className="resize-y" />
        </Field>
        {/* htmlFor: внутри TagInput чипы с кнопками удаления — оборачивание в label ловило бы их клики. */}
        <Field label={t('tags', lang)} htmlFor="ls-tags">
          <TagInput initial={tags} lang={lang} />
        </Field>

        {/* htmlFor: тумблер типа — группа кнопок, не одиночный контрол. */}
        <Field label={t('listKind', lang)} htmlFor="ls-kind">
          <ListTypeToggle ordered={ordered} lang={lang} />
        </Field>

        <FormSaveBar ru={lang === 'ru'} />
      </form>
    </SettingsSection>
  )
}
