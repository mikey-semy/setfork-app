import type { MetadataRoute } from 'next'
import { and, eq, sql } from 'drizzle-orm'
import { db, publiclyVisible, templates, templateVersions, users } from '@/shared/db'
import { getCollections } from '@/features/collections/queries'
import { SITE_ORIGIN } from '@/shared/site'

/**
 * Карта сайта — `/sitemap.xml` по конвенции Next (файл `app/sitemap.ts`).
 *
 * До этого файла её не было ВОВСЕ: `robots.txt` на карту не ссылался, и корпус
 * для поисковика существовал ровно настолько, насколько на него ссылались
 * внутренние страницы. Для домена без внешних ссылок это означает «не существует».
 *
 * ВИДИМОСТЬ БЕРЁМ ГОТОВЫМ ПРЕДИКАТОМ `publiclyVisible()`, а не своим условием:
 * правило «опубликован + публичный + прошёл модерацию» уже написано один раз
 * и используется лентой, страницей списка и админкой. Четвёртая копия разошлась
 * бы предсказуемо — ровно так расходились правила публикации, пока их не свели
 * в один слой. Побочный эффект тот же самый и приятный: черновики, приватные
 * и снятые модерацией сюда не попадают сами, без отдельной оговорки.
 */
/**
 * ⚠️ `force-dynamic`, а НЕ `revalidate`. С `revalidate` этот роут считается
 * пререндеримым, и Next зовёт его ВО ВРЕМЯ СБОРКИ — где базы нет и быть не должно:
 * сборка в CI падала на `ECONNREFUSED 127.0.0.1:5432`, причём падала не в тестах,
 * а на шаге экспорта, то есть после двух зелёных прогонов. Карта сайта обязана
 * читать живую базу, а не ту, что была на момент сборки образа.
 *
 * Цена — четыре запроса на обращение к `/sitemap.xml`. Обходчики ходят сюда
 * редко; когда корпус вырастет, здесь появится кэш на минуты, а не пререндер.
 */
export const dynamic = 'force-dynamic'

const at = (path: string) => `${SITE_ORIGIN}${path}`

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const visible = publiclyVisible()
  /**
   * ⚠️ ИНДЕКСАЦИЯ УЖЕ НЕ ТО ЖЕ, ЧТО ВИДИМОСТЬ, и это ОТДЕЛЬНОЕ условие, а не правка
   * `publiclyVisible()`. Решение 0018: список уровня «порода» (никто не проверял)
   * публиковать можно, но в витрину и в карту сайта он не идёт до первой проверки.
   *
   * Смешать это с видимостью было бы легко и неверно: видимость отвечает на вопрос
   * «кому можно показать», индексация — «что мы предлагаем поисковику как готовое».
   * Спрятать непроверенный список от его же автора и от людей по ссылке никто не
   * просил, а `publiclyVisible()` используют лента, страница списка и админка — правка
   * там ушла бы во все четыре места разом.
   *
   * Уровень живёт у ВЕРСИИ, поэтому смотрим на текущую версию списка.
   */
  const indexable = and(
    visible,
    /**
     * ⚠️ «НЕТ СТРОКИ ВЕРСИИ» — НЕ ТО ЖЕ, ЧТО «ПОРОДА», и здесь это различается намеренно.
     * Порода — сказанное про список утверждение («никто не проверял»), а отсутствие
     * строки версии у опубликованного списка — аномалия данных: так быть не должно, и
     * что это значит, никто не знает. Приравнять их значило бы молча выкинуть из
     * индекса неизвестное число списков под видом правила. Поэтому условие исключает
     * ТОЛЬКО явную породу, а список без версии остаётся в карте — как и до 0018.
     * Сколько таких строк на проде, на 30.08 неизвестно; вопрос заведён в очередь.
     */
    sql`not exists (
      select 1 from ${templateVersions} v
       where v.template_id = ${templates.id}
         and v.version = ${templates.currentVersion}
         and v.verification_level = 'rock'
    )`,
  )

  const [lists, authors, tags, collections] = await Promise.all([
    db
      .select({ handle: users.handle, slug: templates.slug, updatedAt: templates.updatedAt })
      .from(templates)
      .innerJoin(users, eq(templates.ownerId, users.id))
      .where(indexable),
    // Профиль в карте — только у того, у кого есть что показать. Дата — по самому
    // свежему из его публичных списков: профиль «меняется», когда меняются они.
    db
      .select({ handle: users.handle, updatedAt: sql<Date>`max(${templates.updatedAt})` })
      .from(templates)
      .innerJoin(users, eq(templates.ownerId, users.id))
      .where(indexable)
      .groupBy(users.handle),
    // Теги достаём ИЗ ВИДИМЫХ СПИСКОВ, а не из реестра тегов: у реестра свой
    // счётчик использований, и он считает в том числе приватные. Тег, у которого
    // публичных списков нет, дал бы в индексе пустую страницу — то есть мусор.
    db
      .selectDistinct({ tag: sql<string>`unnest(${templates.tags})` })
      .from(templates)
      // ТЕГИ — тоже по индексируемым спискам. Иначе в карту уезжает страница тега, все
      // списки которого порода: для обходчика это посадочная страница, на которой нечего
      // показать, — ровно тот мусор, ради которого теги и берутся из списков, а не из
      // реестра тегов.
      .where(indexable),
    getCollections(),
  ])

  const statics: MetadataRoute.Sitemap = [
    { url: at('/'), changeFrequency: 'daily', priority: 1 },
    { url: at('/explore'), changeFrequency: 'daily', priority: 0.7 },
    { url: at('/trending'), changeFrequency: 'daily', priority: 0.7 },
    { url: at('/tags'), changeFrequency: 'weekly', priority: 0.5 },
    { url: at('/collections'), changeFrequency: 'weekly', priority: 0.6 },
  ]

  return [
    ...statics,
    ...lists.map((l) => ({
      url: at(`/${l.handle}/${l.slug}`),
      lastModified: l.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...collections.map((c) => ({
      url: at(`/collections/${c.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...authors.map((a) => ({
      url: at(`/${a.handle}`),
      lastModified: a.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
    // Теги живут в адресе закодированными: в корпусе они бывают не только латиницей.
    ...tags.map((t) => ({
      url: at(`/tags/${encodeURIComponent(t.tag)}`),
      changeFrequency: 'weekly' as const,
      priority: 0.4,
    })),
  ]
}
