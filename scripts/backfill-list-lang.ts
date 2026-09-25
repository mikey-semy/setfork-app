// Заполнить язык оригинала у существующих списков (ADR-0030). Запуск:
//   npx tsx scripts/backfill-list-lang.ts           # только план: сколько и какой язык, спорные
//   npx tsx scripts/backfill-list-lang.ts --apply   # записать
//
// До ADR-0030 язык текста нигде не хранился, и угадать его можно только по алфавиту: кириллица
// или латиница, то есть `ru` или `en`. Белорусский или немецкий так не отличить — поэтому
// скрипт пишет лишь то, в чём уверен, а СПОРНЫЕ (алфавиты вперемешку) показывает человеку и
// не трогает: автор поставит язык сам, когда появится выбор у списка.
//
// ⚠️ ОРИГИНАЛ, А НЕ ПЕРЕВОД: у 58 списков есть английский перевод, и по текущему тексту русский
// список сошёл бы за английский. Поэтому текст берётся из ПЕРВОЙ версии (перевод пишется новой
// версией и в первой его нет), а название — только если у него один язык.
//
// Пишет только в пустой `templates.lang` — язык, заданный автором, не перезаписывается.
// Текст под ключами не перекладывает: шаги живут в версиях, а версии пишет ядро.
import 'dotenv/config'
import { and, eq, inArray, isNull, min } from 'drizzle-orm'
import { db, steps, templateVersions, templates } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

/**
 * Кириллица от трети букв — русский: русские технические списки полны латинских команд, и
 * треть остаётся надёжным сигналом (то же правило, что у `textLang`). Кириллицы нет —
 * английский. Между ними — СПОРНЫЙ: кириллица есть, но её мало. Такой не пишем, а показываем.
 */
const RU_SHARE = 1 / 3

type Row = { id: string; slug: string; ownerId: string; texts: string[] }

function letters(texts: string[]): { cyr: number; lat: number } {
  let cyr = 0
  let lat = 0
  for (const t of texts) {
    cyr += (t.match(/[а-яёіїєўґ]/gi) ?? []).length
    lat += (t.match(/[a-z]/gi) ?? []).length
  }
  return { cyr, lat }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const lists = await db
    .select({ id: templates.id, slug: templates.slug, ownerId: templates.ownerId, title: templates.title, desc: templates.desc })
    .from(templates)
    .where(isNull(templates.lang))

  const byList = new Map<string, Row>()
  /** Все значения многоязычного поля — у первой версии там один язык, оригинал. */
  const values = (t: LocaleText | null | undefined) => Object.values(t ?? {}).filter((v): v is string => !!v)
  /** Название и описание — только одноязычные: с переводом они уже не говорят об оригинале. */
  const single = (t: LocaleText | null | undefined) => (Object.keys(t ?? {}).length === 1 ? values(t) : [])
  for (const l of lists) byList.set(l.id, { id: l.id, slug: l.slug, ownerId: l.ownerId, texts: [...single(l.title), ...single(l.desc)] })
  if (lists.length) {
    const ids = lists.map((l) => l.id)
    const first = db
      .select({ templateId: templateVersions.templateId, v: min(templateVersions.version).as('v') })
      .from(templateVersions)
      .where(inArray(templateVersions.templateId, ids))
      .groupBy(templateVersions.templateId)
      .as('first')
    const stepRows = await db
      .select({ templateId: templateVersions.templateId, title: steps.title, desc: steps.desc })
      .from(steps)
      .innerJoin(templateVersions, eq(templateVersions.id, steps.versionId))
      .innerJoin(first, and(eq(first.templateId, templateVersions.templateId), eq(first.v, templateVersions.version)))
    for (const s of stepRows) byList.get(s.templateId)?.texts.push(...values(s.title), ...values(s.desc))
  }

  const plan: { id: string; lang: 'ru' | 'en' }[] = []
  const mixed: { slug: string; cyr: number; lat: number }[] = []
  const empty: string[] = []
  for (const r of byList.values()) {
    const { cyr, lat } = letters(r.texts)
    if (cyr + lat === 0) {
      empty.push(r.slug)
      continue
    }
    const share = cyr / (cyr + lat)
    if (cyr > 0 && share < RU_SHARE) {
      mixed.push({ slug: r.slug, cyr, lat })
      continue
    }
    plan.push({ id: r.id, lang: cyr > 0 ? 'ru' : 'en' })
  }

  const count = (lang: string) => plan.filter((p) => p.lang === lang).length
  console.log(`без языка: ${lists.length}`)
  console.log(`  ru: ${count('ru')}, en: ${count('en')}`)
  console.log(`  спорные (не трогаем): ${mixed.length}`)
  for (const m of mixed) console.log(`    ${m.slug}  кириллица ${m.cyr}, латиница ${m.lat}`)
  console.log(`  без текста (не трогаем): ${empty.length}`)

  if (!apply) {
    console.log('\nПлан. Записать: --apply')
    return
  }
  for (const lang of ['ru', 'en'] as const) {
    const ids = plan.filter((p) => p.lang === lang).map((p) => p.id)
    if (ids.length) await db.update(templates).set({ lang }).where(and(inArray(templates.id, ids), isNull(templates.lang)))
  }
  console.log(`\nзаписано: ${plan.length}`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
