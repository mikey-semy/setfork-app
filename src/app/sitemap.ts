import type { MetadataRoute } from 'next'
import { and, eq, sql } from 'drizzle-orm'
import { db, templates, users } from '@/shared/db'
import { indexableFilter } from '@/features/library/queries/shared'
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
  /**
   * ⚠️ ИНДЕКСАЦИЯ НЕ ЗАВИСИТ ОТ УРОВНЯ ПРОВЕРКИ — и это исправление живого инцидента.
   *
   * Решение 0018 говорит: непроверенное не предлагаем поисковику как готовое. Мысль
   * верная, а гейт по НЕЗАПОЛНЕННОЙ колонке дал ровно то, чего никто не хотел: уровни
   * проставлены примерно у полупроцента корпуса, и карта сайта после выкатки схлопнулась
   * до пяти статических адресов — без единого списка, профиля и тега. Проверено на проде
   * 31.08: `curl sitemap.xml` вернул 5 `loc`.
   *
   * Это тот же корень, что в треке стандарта списков: СНАЧАЛА ЗАПОЛНЕНИЕ, ПОТОМ ГЕЙТ.
   * Правило по пустому полю не фильтрует — оно обнуляет.
   *
   * ⚠️ Бэкфилл «поставить всем doc_checked» рассматривался и ОТВЕРГНУТ: это метка без
   * предмета — ровно та ложь, против которой весь продукт.
   *
   * ПРАВИЛО ОДНО на карту сайта и на llms.txt — оба адресата машинные и оба читают наше
   * утверждение о готовности; две копии разошлись бы, и заметить это было бы некому.
   * Поэтому оно живёт в `indexableFilter()`, а не здесь: когда гейт по уровню вернётся
   * (отдельным решением, с порогом по числам), он появится в ОДНОМ месте для обоих.
   */
  const indexable = indexableFilter()

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
