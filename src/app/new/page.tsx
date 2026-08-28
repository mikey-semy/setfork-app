import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { NewListForm } from '@/features/library/NewListForm'
import { DESTRUCTIVE_REASONS } from '@/core/domain/destructive-command'
import { ListEditor } from '@/features/library/list-editor/ListEditor'
import { GatedToggle, ListTypeToggle, VisibilityToggle } from '@/features/library/ListFormToggles'
import { ListSettingsSheet } from '@/features/library/ListSettingsSheet'
import { TagsAndCatalogFields } from '@/features/library/TagsAndCatalogFields'
import { getCatalogTagProfiles } from '@/features/catalogs/queries'
import { PAGE_NARROW } from '@/shared/ui/control'
import { Asterisk } from 'lucide-react'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('newList', lang) }
}

// Параметров адреса у страницы больше НЕТ: отказы приходят значением из действия, а
// `?e=`/`?blocked=` только уносили введённое.
export default async function NewListPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login')
  // Полки владельца с тегами их жильцов: из них форма подскажет, куда положить новый список.
  const catalogs = await getCatalogTagProfiles(session.userId, lang)

  // Отказы приходят ЗНАЧЕНИЕМ из действия, а не адресом `?e=`: переход начинал новый GET
  // и уносил всё набранное — название, описание, теги и пункты редактора. Поэтому здесь
  // остаются только тексты, а показывает их форма.
  const texts = {
    slugTakenTitle: t('slugTakenTitle', lang),
    slugTakenBody: t('slugTakenBody', lang),
    blockedTitle: t('destructiveBlockedTitle', lang),
    blockedBody: t('destructiveBlockedBody', lang),
    blockedReasons: Object.fromEntries(
      DESTRUCTIVE_REASONS.map((r) => [r, t(`destructive.${r}` as Parameters<typeof t>[0], lang)]),
    ),
    quotaReached: t('listQuotaReached', lang),
    noTitle: t('listTitleRequired', lang),
  }

  return (
    <div className={PAGE_NARROW}>
      <FloatingBack href={'/my-lists'} label={t('myLists', lang)} />
      <NewListForm texts={texts}>
        {/* Название страницы уже стоит в шапке приложения. */}
        <PageHeader hideTitle title={t('newList', lang)} />

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
      </NewListForm>
    </div>
  )
}
