// Починка вырожденных слагов списков. Запуск: npx tsx scripts/fix-degenerate-slugs.ts
//
// Зачем: до транслитерации (src/features/library/slug.ts) русский заголовок терял
// всю кириллицу и слаг схлопывался в «-» или пустую строку. Реальный случай —
// MCP-создание «Домашнее маршмеллоу»: список открывался по адресу вида
// /toshkin-mikhail/-/releases, который выглядит как сломанный роут, хотя это
// просто слаг из одного дефиса. Генератор починен, но СТРОКИ В БД остались
// старыми — этот скрипт приводит их к нормальному виду.
//
// Идемпотентен: списки с нормальным слагом не трогает. По умолчанию — сухой
// прогон (только показывает план); запись включается флагом --apply.
import 'dotenv/config'
import { and, eq, ne } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { slugify } from '@/features/library/slug'
import { tr, type LocaleText } from '@/shared/i18n'

/** Слаг считаем вырожденным, если в нём нет ни одной буквы или цифры. */
const isDegenerate = (slug: string): boolean => !/[a-z0-9]/i.test(slug)

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const rows = await db
    .select({ id: templates.id, slug: templates.slug, title: templates.title, ownerId: templates.ownerId, handle: users.handle })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))

  const broken = rows.filter((r) => isDegenerate(r.slug))
  if (!broken.length) {
    console.log('Вырожденных слагов нет — делать нечего.')
    return
  }
  // eslint-disable-next-line no-restricted-syntax -- вывод CLI-скрипта, не UI
  console.log(`Найдено вырожденных слагов: ${broken.length}${apply ? '' : ' (сухой прогон, записи не будет)'}`)

  for (const row of broken) {
    // Заголовок может быть только на одном языке — берём любой доступный.
    const title = tr(row.title as LocaleText, 'ru') || tr(row.title as LocaleText, 'en')
    const base = slugify(title)
    // Уникальность в рамках владельца: тот же контракт, что у uniqueSlug.
    let candidate = base
    for (let i = 2; ; i++) {
      const clash = await db
        .select({ id: templates.id })
        .from(templates)
        .where(and(eq(templates.ownerId, row.ownerId), eq(templates.slug, candidate), ne(templates.id, row.id)))
      if (!clash.length) break
      candidate = `${base}-${i}`
    }

    console.log(`  /${row.handle}/${row.slug}  →  /${row.handle}/${candidate}   («${title}»)`)
    if (apply) await db.update(templates).set({ slug: candidate }).where(eq(templates.id, row.id))
  }

  // eslint-disable-next-line no-restricted-syntax -- вывод CLI-скрипта, не UI
  console.log(apply ? 'Готово — слаги обновлены.' : 'Сухой прогон окончен. Повторить с --apply, чтобы записать.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
