import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ТОЧНОЕ СОВПАДЕНИЕ ВЫШЕ ПОПУЛЯРНОГО.
 *
 * Найденное сортировалось выбранной сортировкой — по умолчанию «в тренде», то есть по
 * звёздам и форкам. Совпадение заголовка не значило ничего: владелец ввёл «Discourse:
 * проект и люди» дословно (02.09.2026) и первым получил «graphile-worker: проект и
 * люди» — тот просто популярнее.
 *
 * Здесь ровно этот случай на живой базе: два списка с одинаковым хвостом заголовка,
 * популярный — не тот, который назвали.
 */
const { db, templates, users } = await import('@/shared/db')
const { getFeed } = await import('@/features/library/queries/feed')

const seed = async (): Promise<void> => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'ranker' }).returning({ id: users.id })
  await db.insert(templates).values([
    {
      ownerId: u.id,
      slug: 'graphile-worker-people',
      title: { ru: 'graphile-worker: проект и люди' },
      status: 'published' as const,
      visibility: 'public' as const,
      // ⚠️ Популярнее в разы: без ранжирования именно он и стоял первым.
      starsCount: 500,
      forksCount: 120,
    },
    {
      ownerId: u.id,
      slug: 'discourse-people',
      title: { ru: 'Discourse: проект и люди' },
      status: 'published' as const,
      visibility: 'public' as const,
      starsCount: 1,
      forksCount: 0,
    },
    {
      ownerId: u.id,
      slug: 'discourse-people-extended',
      // ⚠️ Заголовок СОДЕРЖИТ запрос целиком и добавляет своё. Пословная похожесть у
      // такого списка та же, что у точного совпадения, — различает их только ступень
      // «совпало целиком». Без неё вперёд выходит он: он популярнее.
      title: { ru: 'Discourse: проект и люди — расширенная версия' },
      status: 'published' as const,
      visibility: 'public' as const,
      // Популярнее точного совпадения, но НЕ популярнее графила: иначе сломался бы
      // соседний случай «без запроса порядок прежний», и правка ранжирования выглядела
      // бы проверенной там, где проверялась подтасованная популярность.
      starsCount: 400,
      forksCount: 60,
    },
    {
      ownerId: u.id,
      // Совпадает АДРЕСОМ, а заголовком — нет: пословная похожесть у него нулевая,
      // и различает его только ступень «входит подстрокой».
      slug: 'discourse-setup',
      title: { ru: 'Форум сообщества' },
      status: 'published' as const,
      visibility: 'public' as const,
      starsCount: 5,
      forksCount: 0,
    },
    {
      ownerId: u.id,
      slug: 'choose-forum',
      title: { ru: 'Как выбрать форум' },
      // Слово есть только в описании — это уже третья ступень.
      desc: { ru: 'Сравнение Discourse и Flarum' },
      status: 'published' as const,
      visibility: 'public' as const,
      // Популярнее списка, совпадающего адресом, но не популярнее графила — иначе
      // соседний случай «без запроса популярное впереди» проверял бы этот список.
      starsCount: 300,
      forksCount: 50,
    },
    {
      ownerId: u.id,
      slug: 'discovery-install',
      // Похож на «Discouse» слабее (0.56 против 0.67 — замер word_similarity на той же
      // базе), но популярнее. Спор между ними решает третья ступень.
      title: { ru: 'Discovery: установка' },
      status: 'published' as const,
      visibility: 'public' as const,
      starsCount: 700,
      forksCount: 100,
    },
    {
      ownerId: u.id,
      slug: 'discourse-install',
      title: { ru: 'Discourse: установка' },
      status: 'published' as const,
      visibility: 'public' as const,
      starsCount: 300,
      forksCount: 40,
    },
  ])
}

const titles = async (q: string): Promise<string[]> => {
  const rows = await getFeed({ q }, undefined, undefined)
  return rows.map((r) => (r.title as Record<string, string>).ru)
}

beforeEach(seed)

describe('порядок выдачи поиска', () => {
  it('названный дословно список стоит первым, даже если он самый непопулярный', async () => {
    expect((await titles('Discourse: проект и люди'))[0]).toBe('Discourse: проект и люди')
  })

  it('регистр не меняет дела: это то же самое имя', async () => {
    expect((await titles('discourse: ПРОЕКТ И ЛЮДИ'))[0]).toBe('Discourse: проект и люди')
  })

  it('частичный запрос — подстрока выше похожего, а внутри ступени решает популярность', async () => {
    // «Discourse» входит подстрокой в оба списка Discourse; между ними спор решает
    // прежняя сортировка (в тренде), и это правильно — точного совпадения тут нет.
    const rows = await titles('Discourse')
    expect(rows.slice(0, 2)).toEqual(['Discourse: проект и люди — расширенная версия', 'Discourse: установка'])
  })

  it('совпадение в адресе выше упоминания в описании, даже когда описание популярнее', async () => {
    // ⚠️ У обоих пословная похожесть заголовка нулевая, поэтому без ступени «входит
    // подстрокой» спор решала бы популярность — и список, названный запросом в адресе,
    // уходил бы под чужое описание.
    const rows = await titles('Discourse')
    expect(rows.indexOf('Форум сообщества')).toBeLessThan(rows.indexOf('Как выбрать форум'))
  })

  it('при опечатке вперёд идёт более похожее, а не более популярное', async () => {
    // «Discouse» — опечатка: ни одна из двух ступеней выше тут не срабатывает, запрос не
    // входит подстрокой никуда. Останься только популярность — человек, промахнувшийся
    // мимо буквы, получил бы чужой список.
    const rows = await titles('Discouse')
    expect(rows.indexOf('Discourse: установка')).toBeLessThan(rows.indexOf('Discovery: установка'))
  })

  it('без запроса порядок прежний — популярное впереди', async () => {
    // Ожидание считается ИЗ САМОГО НАБОРА, а не вписано числом: иначе каждый новый
    // список в наборе молча делал бы этот случай проверкой подобранной популярности.
    const rows = await getFeed({}, undefined, undefined)
    const byPopularity = [...rows].sort((a, b) => b.starsCount + b.forksCount - (a.starsCount + a.forksCount))
    expect(rows.map((r) => r.slug)).toEqual(byPopularity.map((r) => r.slug))
  })
})
