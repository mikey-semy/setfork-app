'use client'

import { useState } from 'react'
import { Field } from '@/shared/ui/Field'
import { TagInput } from '@/shared/ui/TagInput'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { guessCatalog, type CatalogProfile } from '@/shared/lib/catalog-match'
import { fill, t, type Lang } from '@/shared/i18n'

/**
 * ТЕГИ И ПОЛКА — в одном компоненте, потому что вторая следует из первых.
 *
 * Поля стоят рядом не для красоты: подсказка полки живёт ровно столько, сколько набор
 * тегов, и разнести их — значит либо подглядывать за чужим полем, либо спрашивать полку
 * до того, как о списке хоть что-то известно.
 *
 * Подсказка НЕ выбирает за человека: она подставляется, пока он не тронул поле сам, и
 * гаснет, как только тронул. Иначе выйдет молчаливое присвоение — список уезжает на полку,
 * о которой автор не просил, и обнаруживается там случайно.
 *
 * Зачем всё это: полки завели полгода назад, и к моменту пакетной раскладки на них лежало
 * 3 списка из 523. Если новый список по-прежнему рождается вне полок, разбор корпуса
 * окажется разовой уборкой.
 */
export function TagsAndCatalogFields({
  lang,
  catalogs,
  initialTags = [],
  initialCatalog = '',
}: {
  lang: Lang
  /** Полки владельца с тегами их жильцов; пусто — полок нет, и выбирать не из чего. */
  catalogs: CatalogProfile[]
  initialTags?: string[]
  initialCatalog?: string
}) {
  const [tags, setTags] = useState<string[]>(initialTags)
  // null — человек ещё не трогал выбор, значит показываем подсказку.
  const [picked, setPicked] = useState<string | null>(initialCatalog || null)

  const guess = picked === null ? guessCatalog(tags, catalogs) : null
  const value = picked ?? guess?.name ?? ''

  return (
    <>
      <Field label={t('tags', lang)} htmlFor="new-tags">
        <TagInput lang={lang} initial={initialTags} onTagsChange={setTags} />
      </Field>

      {catalogs.length > 0 && (
        <Field label={t('catalogHeading', lang)} hint={guess ? fill('catalog.guessWhy', lang, { tags: guess.shared.join(', ') }) : undefined}>
          {/* Значение уезжает на сервер скрытым полем: Select — своя кнопка, а не <select>,
              и сам по себе в форму ничего не кладёт. */}
          <input type="hidden" name="catalog" value={value} />
          <Select value={value || 'none'} onValueChange={(v) => setPicked(v === 'none' ? '' : v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('profile.catalogNone', lang)}</SelectItem>
              {catalogs.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.title || c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </>
  )
}
