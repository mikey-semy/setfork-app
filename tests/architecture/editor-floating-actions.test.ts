import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * СТРАНИЦА С РЕДАКТОРОМ СПИСКА ОБЯЗАНА ДАТЬ ПЛАВАЮЩИЕ ДЕЙСТВИЯ.
 *
 * Правило приняли 09.08.2026 для создания списка: «на длинном списке кнопка в конце
 * формы уезжает за экран, и до неё надо доскроллить». Применили его ровно там, где
 * заметили, — а правят как раз ДЛИННЫЕ списки, и на странице правки кнопки остались
 * последней строкой.
 *
 * 22.09.2026 владелец сообщил, чем это кончается: на списке в 120 пунктов он до кнопок
 * не добрался вовсе — вкладка падала по памяти раньше, чем он долистывал. Между
 * принятием правила и этой жалобой прошло полтора месяца, и всё это время обе страницы
 * по отдельности выглядели правильными.
 *
 * Это корень K41 «убрали из одного места, забыли про второе» в его втором виде:
 * ПОЧИНИЛИ одно место из двух. По правилу карты корней третий повтор обязан получить
 * машинную проверку — вот она.
 *
 * Проверка текстовая: страницы — серверные компоненты, в них нет ни состояния, ни
 * поведения, которое можно было бы прогнать. Предмет проверки — не вёрстка, а то, что
 * автор новой страницы С РЕДАКТОРОМ принял решение осознанно.
 */
const APP = new URL('../../src/app', import.meta.url).pathname

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) pages(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}

/** Страницы, показывающие редактор списка. Признак — сам редактор, а не имя файла. */
const withEditor = pages(APP)
  .map((file) => ({ rel: relative(APP, file), text: readFileSync(file, 'utf8') }))
  .filter(({ text }) => /<ListEditor[\s/>]/.test(text))

describe('редактор списка: главное действие видно с любого места формы', () => {
  it('сканер видит страницы с редактором — иначе «нарушений нет» ничего не значит', () => {
    // Контроль к самому себе: при пустой выборке проверка ниже прошла бы молча.
    expect(withEditor.map((p) => p.rel).sort(), 'страницы с <ListEditor> не найдены — сканер смотрит не туда').toEqual([
      '[handle]/[slug]/edit/page.tsx',
      '[handle]/[slug]/suggest/page.tsx',
      '[handle]/[slug]/suggestions/[id]/edit/page.tsx',
      'new/page.tsx',
    ])
  })

  it('каждая зовёт FloatingActions', () => {
    const silent = withEditor.filter(({ text }) => !/<FloatingActions[\s>]/.test(text)).map((p) => p.rel)
    expect(
      silent,
      'страница показывает редактор, но главное действие оставлено в потоке: на длинном списке до него не доскроллить',
    ).toEqual([])
  })

  it('никто не рисует свою плавающую панель мимо общей', () => {
    // Вторая половина правила. Без неё запрет обходится копированием `fixed bottom-5`
    // на новую страницу — и панель снова начнёт жить в трёх местах, расходясь в мелочах
    // (поправка на видимый низ экрана была ровно в одном из двух).
    const home = /^src\/shared\/ui\/FloatingActions\.tsx$/
    const handmade = pages(APP)
      .map((file) => ({ rel: relative(APP, file), text: readFileSync(file, 'utf8') }))
      .filter(({ rel, text }) => !home.test(rel) && /data-sticky-input/.test(text) && /fixed[^"']*bottom-/.test(text))
      .map((p) => p.rel)
    expect(handmade, 'своя плавающая панель вместо общей FloatingActions').toEqual([])
  })
})
