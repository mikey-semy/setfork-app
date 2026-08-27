import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { createTemplate } from '@/features/library/actions'
import { ListEditor } from '@/features/library/list-editor/ListEditor'
import { GatedToggle, ListTypeToggle, VisibilityToggle } from '@/features/library/ListFormToggles'
import { ListSettingsSheet } from '@/features/library/ListSettingsSheet'
import { TagsAndCatalogFields } from '@/features/library/TagsAndCatalogFields'
import { getCatalogTagProfiles } from '@/features/catalogs/queries'
import { listQuota } from '@/shared/quota'
import { PAGE_NARROW } from '@/shared/ui/control'
import { Asterisk } from 'lucide-react'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('newList', lang) }
}

export default async function NewListPage({ searchParams }: { searchParams: Promise<{ e?: string; blocked?: string; step?: string; slug?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
  const quotaHit = sp.e === 'list_quota'
  // Полки владельца с тегами их жильцов: из них форма подскажет, куда положить новый список.
  const [q, catalogs] = await Promise.all([
    quotaHit ? listQuota(session.userId, session.handle) : Promise.resolve(null),
    getCatalogTagProfiles(session.userId, lang),
  ])

  return (
    <div className={PAGE_NARROW}>
      <FloatingBack href={'/my-lists'} label={t('myLists', lang)} />
      <form action={createTemplate}>
        {/* Название страницы уже стоит в шапке приложения. */}
        <PageHeader hideTitle title={t('newList', lang)} />

        {/* Отказ стража исполняемых команд: причина словами и номер шага — иначе
            кнопка «Создать» выглядит сломанной. */}
        {/* Адрес занят. Текст ядра на этом отказе — `already exists`, четырнадцать
            символов, не говорящие даже о том, ЧТО занято. Человеку нужно другое: что
            именно занято, кем это можно исправить и одним ли действием. */}
        {sp.e === 'slug_taken' && (
          <Alert variant="danger" className="mb-5">
            <span className="block font-semibold">{t('slugTakenTitle', lang)}</span>
            <span className="block">{t('slugTakenBody', lang).replace('{slug}', sp.slug ?? '')}</span>
          </Alert>
        )}

        {sp.blocked && (
          <Alert variant="danger" className="mb-5">
            <span className="block font-semibold">{t('destructiveBlockedTitle', lang)}</span>
            <span className="block">
              {t('destructiveBlockedBody', lang)
                .replace('{n}', sp.step ?? '?')
                .replace('{reason}', t(`destructive.${sp.blocked}` as Parameters<typeof t>[0], lang))}
            </span>
          </Alert>
        )}

        {quotaHit && q && (
          <Alert variant="warn" className="mb-5">
            {t('listQuotaReached', lang).replace('{n}', String(q.limit))}
          </Alert>
        )}

        {/* На экране — только название и пункты. Остальные свойства (описание, теги,
            тип, видимость, курс) заполняют один раз, а места занимали столько же,
            сколько сам редактор, — поэтому они в боковой панели (решение владельца).

            Название и свойства уезжают ВНУТРЬ редактора: там они встают в один ряд с
            его действиями (отмена, повтор, просмотр, код), и полоса под словом
            «Пункты» больше не нужна. */}
        <ListEditor
          name="items"
          initialItems={[]}
          lang={lang}
          aiRefine={{ title: '', desc: '', tags: [] }}
          headerField={
            /*
             * Три правки одного поля, все по обходу владельца 27.08.2026.
             *
             * `size="lg"` — ступень СОСЕДЕЙ. Поля пунктов ниже это BubbleTextEditor с
             * `px-3 py-2`, то есть около 40px; заголовок стоял на `md` (32px) и выглядел
             * ниже всего, что под ним. Ряд задаёт не он, а блок пункта.
             *
             * Подсказка говорит О ПОЛЕ. Было «Деплой на VPS» — это ПРИМЕР значения, и
             * человек читает его как уже введённый текст либо как указание писать про
             * деплой. Пример уместен там, где формат неочевиден (адрес, тег), а у названия
             * формата нет.
             *
             * Обязательность ВИДНА. Атрибут `required` был, а глазу не говорил ничего —
             * при том что прямо под полем уровень пункта свою обязательность показывает
             * знаком. Звёздочка — второй признак к атрибуту, не замена ему.
             */
            <Input
              name="title"
              required
              size="lg"
              placeholder={t('listTitlePh', lang)}
              aria-label={t('listTitle', lang)}
              trailing={
                <span aria-label={t('listTitleRequiredMark', lang)} role="img" className="text-danger">
                  <Asterisk size={13} />
                </span>
              }
            />
          }
          headerRight={
          <ListSettingsSheet lang={lang}>
            <Field label={t('listDesc', lang)}>
              <Input name="desc" placeholder={t('listDescPh', lang)} />
            </Field>

            {/* Теги и полка идут ВМЕСТЕ: вторая выводится из первых, и порознь подсказка
                либо подглядывает за чужим полем, либо спрашивает полку до того, как о
                списке хоть что-то известно. */}
            <TagsAndCatalogFields lang={lang} catalogs={catalogs} />

            {/* htmlFor: внутри каждого тумблера свои label — вложенные невалидны. */}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <Field label={t('listKind', lang)} htmlFor="new-kind">
                <ListTypeToggle ordered lang={lang} />
              </Field>
              <Field label={t('visibility', lang)} htmlFor="new-visibility">
                <VisibilityToggle isPublic lang={lang} />
              </Field>
              <Field label={t('gatedShort', lang)} htmlFor="new-gated">
                <GatedToggle gated={false} lang={lang} />
              </Field>
            </div>
          </ListSettingsSheet>
          }
        />

        {/* Создание — ПЛАВАЮЩЕЙ кнопкой справа внизу (решение владельца 09.08):
            на длинном списке кнопка в конце формы уезжает за экран, и до неё надо
            доскроллить. Слева внизу уже живёт плавающий «назад» — пара занимает
            оба нижних угла, между ними центр остаётся свободным под инсертер. */}
        {/* `data-sticky-input` — признак нижней плавающей панели: по нему кнопка
            «наверх» садится ВЫШЕ неё, а не поверх (механика ScrollToTop, она же
            разводит чат раскопок и полосу сохранения). */}
        <div data-sticky-input className="fixed right-5 bottom-5 z-40 print:hidden">
          <SubmitButton className="shadow-card">{t('listCreate', lang)}</SubmitButton>
        </div>
      </form>
    </div>
  )
}
