import type { ReactNode } from 'react'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { TagInput } from '@/shared/ui/TagInput'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Field } from '@/shared/ui/Field'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { ListTypeToggle } from './ListFormToggles'
import { LanguagePicker } from '@/shared/ui/LanguagePicker'
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
  sourceLang,
  lang,
  refusal,
}: {
  /** Отказ прошлого сохранения — над полями, которые его вызвали. */
  refusal?: ReactNode
  templateId: string
  title: LocaleText
  desc: LocaleText
  tags: string[]
  ordered: boolean
  /** Язык оригинала (ADR-0030); пусто — не задан, угадывается по алфавиту. */
  sourceLang: string | null
  lang: Lang
}) {
  const save = updateListMeta.bind(null, templateId)

  return (
    <SettingsSection title={t('generalTitle', lang)}>
      <form action={save} className="flex flex-col gap-4">
        {refusal}
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

        {/* htmlFor: выбиралка — кнопка с панелью, а не поле ввода. */}
        <Field label={t('lang.sourceLabel', lang)} hint={t('lang.sourceHint', lang)} htmlFor="ls-source-lang">
          {/* «Не задан» можно вернуть: тогда язык угадывается по алфавиту текста. */}
          <LanguagePicker id="ls-source-lang" name="sourceLang" defaultValue={sourceLang} lang={lang} label={t('lang.sourceLabel', lang)} noneLabel={t('lang.notSet', lang)} />
        </Field>

        <FormSaveBar lang={lang} />
      </form>
    </SettingsSection>
  )
}
