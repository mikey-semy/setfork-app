// Слаги и теги списка — инфраструктура записи, не фича.
//
// Лежало в features/library/slug.ts, но нужно ВСЕМ, кто создаёт списки: генерация, MCP,
// каталоги, админка и петля ухода (расхождение форком). Для features/gardener это означало
// бы третий кросс-импорт в library — а границы слоёв запрещают фичам видеть друг друга (и
// правильно: цепочка «садовник → library → …» уже дважды приводила к запутанным зависимостям).
// Поэтому helpers переехали в shared, а features/library/slug.ts остался ре-экспортом,
// чтобы существующие импорты не переписывать одним махом.
//
// ЗДЕСЬ — только то, что ходит в базу. Чистые правила имени живут в ./slugify и годятся
// клиенту: из-за одного slugify в клиентском компоненте Turbopack тянул сюда драйвер
// `pg` и валил сборку на `Can't resolve 'dns'`.

import { slugify } from './slugify'

export { parseTags, slugify } from './slugify'

/**
 * Свободен ли слаг у этого владельца.
 *
 * Занятым считается и ПРЕЖНИЙ адрес переименованного списка: он всё ещё ведёт на
 * него — из чужих ссылок, из git remote в клонах, из памяти агентов. Отдать такой
 * слаг новому списку значило бы увести чужой трафик на другой контент; именно здесь
 * мы расходимся с Gitea и GitHub, где освободившееся имя занимается заново.
 */
async function slugTaken(slug: string, ownerId: string, exceptTemplateId?: string): Promise<boolean> {
  const [{ db, listRedirects, templates }, { and, eq, ne }] = await Promise.all([
    import('@/shared/db'),
    import('drizzle-orm'),
  ])
  const [live, previous] = await Promise.all([
    db
      .select({ slug: templates.slug })
      .from(templates)
      .where(and(eq(templates.ownerId, ownerId), eq(templates.slug, slug)))
      .limit(1),
    db
      .select({ slug: listRedirects.slug })
      .from(listRedirects)
      .where(
        and(
          eq(listRedirects.ownerId, ownerId),
          eq(listRedirects.slug, slug),
          // СВОИ прежние адреса занятыми не считаются — иначе к прежнему имени нельзя
          // вернуться: переименовал `a` → `b`, а обратно уже «занято» самим собой.
          ...(exceptTemplateId ? [ne(listRedirects.templateId, exceptTemplateId)] : []),
        ),
      )
      .limit(1),
  ])
  return live.length > 0 || previous.length > 0
}

/** Уникальный слаг в рамках владельца: добавляет короткий суффикс при коллизии. */
export async function uniqueSlug(base: string, ownerId: string): Promise<string> {
  const slug = slugify(base)
  return (await slugTaken(slug, ownerId)) ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug
}

/**
 * Сколько вариантов со счётчиком перебрать, прежде чем сдаться.
 *
 * Считанный десяток — потому что предложение нужно ЧЕЛОВЕКУ: `-2`, `-3` он прочитает и
 * примет, а `-47` уже бессмысленно, там проще придумать другое имя. Дальше отвечаем
 * «занято» без подсказки, а не подбираем до победного — иначе редкий случай стоил бы
 * сотни запросов к базе.
 */
const SUGGEST_TRIES = 9

/**
 * Свободный адрес, похожий на желаемый: `deploy`, `deploy-2`, `deploy-3`…
 *
 * Именно счётчик, а не случайный суффикс: человек должен узнавать в предложении своё
 * имя. Так же подбирает адрес приём списка при передаче владения.
 */
export async function suggestFreeSlug(
  raw: string,
  ownerId: string,
  exceptTemplateId?: string,
): Promise<string | null> {
  const base = slugify(raw)
  if (!(await slugTaken(base, ownerId, exceptTemplateId))) return base
  for (let i = 2; i <= SUGGEST_TRIES + 1; i++) {
    const candidate = `${base}-${i}`
    if (!(await slugTaken(candidate, ownerId, exceptTemplateId))) return candidate
  }
  return null
}

/** Слаг, введённый человеком при переименовании: та же нормализация и та же занятость. */
export async function checkSlugAvailable(
  raw: string,
  ownerId: string,
  /** Список, который переименовывают: его собственные прежние адреса свободны для него. */
  templateId?: string,
): Promise<{ slug: string; free: boolean }> {
  const slug = slugify(raw)
  return { slug, free: !(await slugTaken(slug, ownerId, templateId)) }
}
