// Заполнить язык оригинала у существующих списков (ADR-0030). Запуск:
//   npx tsx scripts/backfill-list-lang.ts           # только план: сколько и какой язык, спорные
//   npx tsx scripts/backfill-list-lang.ts --apply   # записать
//
// До ADR-0030 язык текста нигде не хранился, и угадать его можно только по алфавиту — уверенно
// лишь русский и английский. Поэтому скрипт пишет ТОЛЬКО то, в чём уверен
// (`classifyListLang`), а спорные показывает человеку и не трогает: автор поставит язык сам,
// когда появится выбор у списка. Записанное значение дальше считается авторским.
//
// ⚠️ ОРИГИНАЛ, А НЕ ПЕРЕВОД: у 58 списков есть английский перевод, и по текущему тексту русский
// список сошёл бы за английский. Поэтому текст берётся из ПЕРВОЙ версии (перевод пишется новой
// версией и в первой его нет), а название — только если у него один язык. Если же в первой
// версии у шага два языка — это копия переведённого списка (форк и «как шаблон» копируют шаги
// вместе с переводом): оригинал по ней не определить, список идёт в спорные.
//
// Пишет только в пустой `templates.lang` — язык, заданный автором, не перезаписывается.
// Текст под ключами не перекладывает: шаги живут в версиях, а версии пишет ядро.
import 'dotenv/config'
import { and, eq, inArray, isNull, min } from 'drizzle-orm'
import { db, steps, templateVersions, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { classifyListLang } from '@/shared/i18n/detect-text-lang'

type Row = { id: string; ref: string; texts: string[]; multiKey: boolean }

/** Непустые значения многоязычного поля. */
const values = (t: LocaleText | null | undefined) => Object.values(t ?? {}).filter((v): v is string => !!v)

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const lists = await db
    .select({ id: templates.id, slug: templates.slug, handle: users.handle, title: templates.title, desc: templates.desc })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(isNull(templates.lang))

  const byList = new Map<string, Row>()
  // Название и описание — только одноязычные: с переводом они уже не говорят об оригинале.
  const single = (t: LocaleText | null | undefined) => (values(t).length === 1 ? values(t) : [])
  for (const l of lists) byList.set(l.id, { id: l.id, ref: `${l.handle}/${l.slug}`, texts: [...single(l.title), ...single(l.desc)], multiKey: false })
  if (lists.length) {
    const first = db
      .select({ templateId: templateVersions.templateId, v: min(templateVersions.version).as('v') })
      .from(templateVersions)
      .where(inArray(templateVersions.templateId, lists.map((l) => l.id)))
      .groupBy(templateVersions.templateId)
      .as('first')
    const stepRows = await db
      .select({ templateId: templateVersions.templateId, title: steps.title, desc: steps.desc })
      .from(steps)
      .innerJoin(templateVersions, eq(templateVersions.id, steps.versionId))
      .innerJoin(first, and(eq(first.templateId, templateVersions.templateId), eq(first.v, templateVersions.version)))
    for (const s of stepRows) {
      const r = byList.get(s.templateId)
      if (!r) continue
      if (values(s.title).length > 1 || values(s.desc).length > 1) r.multiKey = true
      r.texts.push(...values(s.title), ...values(s.desc))
    }
  }

  const plan: { id: string; lang: 'ru' | 'en' }[] = []
  const mixed: string[] = []
  const empty: string[] = []
  for (const r of byList.values()) {
    const kind = classifyListLang(r.texts, r.multiKey)
    if (kind === 'ru' || kind === 'en') plan.push({ id: r.id, lang: kind })
    else if (kind === 'mixed') mixed.push(r.multiKey ? `${r.ref}  (копия переведённого: в первой версии два языка)` : r.ref)
    else empty.push(r.ref)
  }

  const count = (lang: string) => plan.filter((p) => p.lang === lang).length
  console.log(`без языка: ${lists.length}`)
  console.log(`  ru: ${count('ru')}, en: ${count('en')}`)
  console.log(`  спорные (не трогаем): ${mixed.length}`)
  for (const m of mixed) console.log(`    ${m}`)
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
