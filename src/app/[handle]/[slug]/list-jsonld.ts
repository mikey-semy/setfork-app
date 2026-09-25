import { servedLang, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { breadcrumbList, creativeWork, howTo, itemList } from '@/shared/seo/jsonld'

/**
 * РАЗМЕТКА СТРАНИЦЫ СПИСКА ДЛЯ ПОИСКОВИКА — чистой функцией, чтобы её можно было проверить.
 *
 * Страница только рисует то, что вернулось. Раньше разметка собиралась прямо в JSX, и
 * проводку `inLanguage` не держал ни один тест: убранная со всех трёх блоков, она оставляла
 * набор зелёным (ревью по линзам к ADR-0029).
 *
 * `inLanguage` — язык ТЕКСТА списка, а не интерфейса: языка в адресе нет (ADR-0029), и
 * русский список обязан объявлять себя русским при любом языке у робота.
 */
export interface ListJsonLdInput {
  tpl: {
    title: LocaleText
    desc: LocaleText
    tags: string[]
    createdAt?: Date | string | null
    updatedAt?: Date | string | null
    ownerName?: string | null
  }
  owner: string
  slug: string
  lang: Lang
  /** Показанная версия: может быть не текущей, а на некоторых путях её нет вовсе. */
  version?: number
  steps: { n: number | string; title: LocaleText }[]
  /**
   * Шаги инструкции для `HowTo` — только если страница действительно инструкция
   * (`howToEligible`), иначе `null`. ⚠️ ТОЛЬКО блоки-шаги: текст, картинка, опрос и тест
   * шагами не считаются (`isStepBlock`), объявить их шагами — соврать о составе. ⚠️ ВСЕ
   * шаги, без потолка: инструкция, обрезанная на 25-м, объявляет процедуру законченной там,
   * где страница продолжается (находка авто-ревью).
   */
  howToSteps: { n: number | string; title: LocaleText; desc: LocaleText }[] | null
}

export function listJsonLd(o: ListJsonLdInput): Record<string, unknown>[] {
  const { tpl, owner, slug, lang } = o
  const path = `/${owner}/${slug}`
  const name = tr(tpl.title, lang) || slug
  const description = tr(tpl.desc, lang) || undefined
  const inLanguage = servedLang(tpl.title, lang)
  const out: Record<string, unknown>[] = [
    creativeWork({
      name: tr(tpl.title, lang),
      description,
      path,
      authorName: tpl.ownerName || owner,
      authorPath: `/${owner}`,
      datePublished: tpl.createdAt ?? undefined,
      dateModified: tpl.updatedAt ?? undefined,
      tags: tpl.tags,
      version: o.version,
      inLanguage,
    }),
    breadcrumbList([{ name: owner, path: `/${owner}` }, { name, path }]),
    // Шаги списком: это то, ЧТО здесь исполняется. Потолок в 25 — чтобы разметка не
    // раздувалась на курсах в сотню уроков.
    itemList(
      name,
      o.steps.slice(0, 25).map((s) => ({ name: tr(s.title, lang) || `${s.n}` })),
      inLanguage,
    ),
  ]
  if (o.howToSteps) {
    out.push(
      howTo({
        name,
        description,
        path,
        inLanguage,
        steps: o.howToSteps.map((s) => ({ name: tr(s.title, lang) || `${s.n}`, text: tr(s.desc, lang) || undefined })),
      }),
    )
  }
  return out
}
