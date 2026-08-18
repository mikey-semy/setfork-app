import { describe, expect, it } from 'vitest'
import {
  AFTER_PARAM,
  BEFORE_PARAM,
  cursorHref,
  decodeCursor,
  encodeCursor,
  feedWindow,
  LISTS_PER_PAGE,
  MAX_PAGE,
  pageCount,
  pageFromParam,
  pageHref,
  pageNumbers,
  pageWindow,
  probeLimit,
  probeWindow,
  takePage,
} from '@/shared/lib/paging'

// Арифметика страниц выглядит очевидной ровно до первой ошибки в ней: смещение на единицу
// тихо теряет двадцатый список или показывает его дважды, и заметить это можно только
// пересчитав выдачу руками. Поэтому она живёт в одном месте и проверяется здесь.

describe('окно запроса', () => {
  it('первая страница начинается с нуля', () => {
    expect(pageWindow(1)).toEqual({ limit: LISTS_PER_PAGE, offset: 0 })
  })

  it('вторая продолжает первую без зазора и без нахлёста', () => {
    expect(pageWindow(2)).toEqual({ limit: LISTS_PER_PAGE, offset: LISTS_PER_PAGE })
  })

  it('мусор в номере страницы читается как первая', () => {
    // Номер приходит из адреса, то есть от кого угодно.
    expect(pageWindow(0).offset).toBe(0)
    expect(pageWindow(-5).offset).toBe(0)
    expect(pageWindow(NaN).offset).toBe(0)
    expect(pageWindow(2.7).offset).toBe(LISTS_PER_PAGE)
  })
})

describe('число страниц', () => {
  it('ровное деление не даёт лишней пустой страницы', () => {
    expect(pageCount(LISTS_PER_PAGE)).toBe(1)
    expect(pageCount(LISTS_PER_PAGE * 2)).toBe(2)
  })

  it('остаток занимает свою страницу', () => {
    expect(pageCount(LISTS_PER_PAGE + 1)).toBe(2)
  })

  it('пустая выдача — это одна страница, а не ноль', () => {
    // Ноль страниц означал бы, что показывать нечего даже пустое состояние.
    expect(pageCount(0)).toBe(1)
  })
})

describe('номер страницы из адреса', () => {
  it('за краем приводится к последней существующей', () => {
    expect(pageFromParam('99', 3)).toBe(3)
  })

  it('мусор и отсутствие — первая', () => {
    expect(pageFromParam(undefined, 3)).toBe(1)
    expect(pageFromParam('-2', 3)).toBe(1)
    expect(pageFromParam('пятая', 3)).toBe(1)
  })
})

// Битое окно обязано падать, а не «показывать всё». Драйвер молча выбрасывает предел,
// который не число, — так главная и отдавала все 518 списков при внешне верном коде.
describe('проверка окна перед запросом', () => {
  it('пропускает целое положительное окно как есть', () => {
    expect(feedWindow({ limit: 7 })).toEqual({ limit: 7, offset: 0 })
    expect(feedWindow({ limit: 7, offset: 14 })).toEqual({ limit: 7, offset: 14 })
  })

  it('падает на пределе, который не число', () => {
    // Именно этот случай и был живым: через границу RSC константа приезжала функцией.
    expect(() => feedWindow({ limit: (() => 7) as unknown as number })).toThrow(/limit/)
    expect(() => feedWindow({ limit: undefined as unknown as number })).toThrow(/limit/)
    expect(() => feedWindow({ limit: '7' as unknown as number })).toThrow(/limit/)
  })

  it('падает на пустом и дробном пределе, а не режет молча', () => {
    expect(() => feedWindow({ limit: 0 })).toThrow(/limit/)
    expect(() => feedWindow({ limit: -1 })).toThrow(/limit/)
    expect(() => feedWindow({ limit: 7.5 })).toThrow(/limit/)
  })

  it('падает на битом смещении', () => {
    expect(() => feedWindow({ limit: 7, offset: -1 })).toThrow(/offset/)
    expect(() => feedWindow({ limit: 7, offset: NaN })).toThrow(/offset/)
  })

  it('не трогает само значение, сообщая о нём — иначе ошибка подменится чужой', () => {
    // Ссылка на клиентский модуль бросает на любом обращении, включая valueOf.
    const hostile = new Proxy(() => {}, {
      get: () => {
        throw new Error('Cannot access on the server')
      },
    }) as unknown as number
    expect(() => feedWindow({ limit: hostile })).toThrow(TypeError)
  })
})

// Ссылку на страницу писала каждая страница сама, и они разошлись: где-то фильтры
// переносились, где-то молча слетали. Теперь построитель один — и правила у него одни.
describe('ссылка на страницу', () => {
  it('первая страница живёт по адресу без ?page — чтобы адрес у неё был один', () => {
    expect(pageHref('/tags/go', {})(1)).toBe('/tags/go')
    expect(pageHref('/tags/go', { sort: 'new' })(1)).toBe('/tags/go?sort=new')
  })

  it('переносит остальные параметры, меняя ровно номер', () => {
    const href = pageHref('/miki', { tab: 'lists', catalog: 'devops', q: 'nginx' })
    expect(href(3)).toBe('/miki?tab=lists&catalog=devops&q=nginx&page=3')
  })

  it('прежний номер не липнет ко второму переходу', () => {
    expect(pageHref('/x', { page: '7', q: 'a' })(2)).toBe('/x?q=a&page=2')
  })

  it('пустые значения не превращаются в мусор в адресе', () => {
    expect(pageHref('/x', { q: '', sort: undefined, type: null })(2)).toBe('/x?page=2')
  })

  it('принимает и готовые URLSearchParams', () => {
    expect(pageHref('/x', new URLSearchParams({ q: 'go', page: '4' }))(2)).toBe('/x?q=go&page=2')
  })
})

describe('окно-разведчик', () => {
  it('просит на строку больше, чем покажет', () => {
    expect(probeWindow(1, 20)).toEqual({ limit: 21, offset: 0 })
    expect(probeWindow(3, 20)).toEqual({ limit: 21, offset: 40 })
  })

  it('лишняя строка отвечает «дальше есть» и на экран не попадает', () => {
    const rows = Array.from({ length: 21 }, (_, i) => i)
    expect(takePage(rows, 20)).toEqual({ items: rows.slice(0, 20), hasNext: true })
  })

  it('ровно страница — значит дальше ничего', () => {
    expect(takePage([1, 2, 3], 3)).toEqual({ items: [1, 2, 3], hasNext: false })
    expect(takePage([], 3)).toEqual({ items: [], hasNext: false })
  })
})

describe('номера в листалке', () => {
  it('короткая выдача показывается целиком, без многоточий', () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('в середине сворачивается с обеих сторон', () => {
    expect(pageNumbers(40, 74)).toEqual([1, 'gap', 39, 40, 41, 'gap', 74])
  })

  it('у краёв окно разворачивается внутрь, а не схлопывается', () => {
    // Иначе на первой странице номеров меньше, чем в середине, и ряд прыгает по ширине
    // при каждом переходе. Ячеек ровно семь и там, и там — одно многоточие вместо двух.
    expect(pageNumbers(1, 74)).toEqual([1, 2, 3, 4, 5, 'gap', 74])
    expect(pageNumbers(74, 74)).toEqual([1, 'gap', 70, 71, 72, 73, 74])
  })

  it('многоточие не прячет ровно одну страницу — это обман без экономии места', () => {
    // Шесть страниц: раньше выходило [1,2,3,4,…,6] — многоточие вместо единственной
    // пятой. Места столько же, а страница недостижима в один клик.
    expect(pageNumbers(1, 6)).toEqual([1, 2, 3, 4, 5, 6])
    expect(pageNumbers(6, 6)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('ширина ряда постоянна: отцентрованный ряд не должен разъезжать стрелки', () => {
    // Ряд отцентрован, поэтому лишняя ячейка сдвигает ОБЕ стрелки наружу примерно на их
    // ширину — палец, занесённый над «вперёд», попадает мимо. Раньше на 74 страницах
    // третья давала шесть ячеек, четвёртая семь, то есть ряд прыгал на обычном шаге.
    for (const total of [8, 9, 12, 20, 74, 1000]) {
      const widths = new Set(Array.from({ length: total }, (_, i) => pageNumbers(i + 1, total).length))
      expect(widths.size).toBe(1)
    }
  })

  it('многоточие ставится только там, где за ним правда несколько страниц', () => {
    for (const total of [7, 8, 9, 12, 20, 74, 1000]) {
      for (let p = 1; p <= total; p++) {
        const nums = pageNumbers(p, total)
        nums.forEach((v, i) => {
          if (v !== 'gap') return
          const before = nums[i - 1] as number
          const after = nums[i + 1] as number
          expect(after - before).toBeGreaterThan(2)
        })
      }
    }
  })

  it('текущая страница и оба края есть в ряду всегда', () => {
    for (const total of [1, 5, 7, 8, 74, 1000]) {
      for (const p of [1, 2, Math.ceil(total / 2), total - 1, total].filter((v) => v >= 1 && v <= total)) {
        const nums = pageNumbers(p, total)
        expect(nums).toContain(p)
        expect(nums[0]).toBe(1)
        expect(nums[nums.length - 1]).toBe(total)
      }
    }
  })

  it('первая и последняя страницы есть всегда — на них прыгают чаще всего', () => {
    for (const p of [1, 2, 20, 73, 74]) {
      const nums = pageNumbers(p, 74)
      expect(nums[0]).toBe(1)
      expect(nums[nums.length - 1]).toBe(74)
      expect(nums).toContain(p)
    }
  })
})

// Дробь в адресе доезжала до листалки как есть и расходилась со всеми, кто номер
// округляет: окно просило вторую страницу, разметка рисовала «2.9» и строила ссылку
// на «3.9000000000000004», а страница переспрашивала выдачу второй раз впустую.
describe('номер страницы из адреса', () => {
  it('дробный номер округляется вниз до существующей страницы', () => {
    expect(pageFromParam('2.9', 10)).toBe(2)
    expect(pageFromParam('1.0000000000000002', 10)).toBe(1)
  })

  it('мусор и выход за край по-прежнему приводятся к существующей', () => {
    expect(pageFromParam(undefined, 10)).toBe(1)
    expect(pageFromParam('нет', 10)).toBe(1)
    expect(pageFromParam('0', 10)).toBe(1)
    expect(pageFromParam('-5', 10)).toBe(1)
    expect(pageFromParam('999', 10)).toBe(10)
  })

  it('результат всегда целый — на нём стоит и окно, и подсветка текущей', () => {
    for (const raw of ['2.9', '0.5', '-1.2', '7.999', 'nope']) {
      expect(Number.isInteger(pageFromParam(raw, 10))).toBe(true)
    }
  })
})

// Номер страницы приходит из адреса, то есть от кого угодно: `1e999` давал Infinity —
// смещение переставало быть целым, строгая проверка окна роняла страницу пятисоткой.
describe('потолок номера страницы', () => {
  it('бесконечность и запредельные номера не выносятся в смещение', () => {
    expect(pageWindow(Infinity)).toEqual({ limit: LISTS_PER_PAGE, offset: (MAX_PAGE - 1) * LISTS_PER_PAGE })
    expect(pageWindow(1e18)).toEqual({ limit: LISTS_PER_PAGE, offset: (MAX_PAGE - 1) * LISTS_PER_PAGE })
  })

  it('смещение остаётся безопасным целым — его принимает и проверка окна, и bigint базы', () => {
    for (const p of [Infinity, 1e18, 1e999, MAX_PAGE * 5]) {
      const w = pageWindow(p)
      expect(Number.isSafeInteger(w.offset)).toBe(true)
      expect(() => feedWindow(w)).not.toThrow()
    }
  })
})

describe('keyset: курсор', () => {
  const KEY = '2026-08-18 19:02:03.092835+00'
  const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

  it('кодирование обратимо и полную точность ключа не теряет', () => {
    const c = decodeCursor(encodeCursor({ key: KEY, id: ID }))
    expect(c).toEqual({ key: KEY, id: ID })
    // Микросекунды — не украшение: на них и держится вся правильность keyset.
    expect(c!.key).toContain('.092835')
  })

  it('в адрес попадает без символов, которые там значат другое', () => {
    const raw = encodeCursor({ key: KEY, id: ID })
    expect(raw).not.toMatch(/[+/=:&?#]/)
    expect(encodeURIComponent(raw)).toBe(raw)
  })

  it('мусор — это «показать сначала», а не падение', () => {
    const bads = [undefined, null, '', 'not-base64!!', btoa('no-separator'), btoa(`${KEY}~not-a-uuid`), btoa(`not-a-date~${ID}`)]
    for (const bad of bads) expect(decodeCursor(bad as string | undefined)).toBeNull()
  })

  it('ключ не-ASCII — громкая ошибка программиста, а не поломка в браузере', () => {
    // btoa умеет только Latin-1. Ключи keyset — метки времени и uuid, но если ключом
    // однажды сделают текст, узнать об этом надо здесь, а не посреди листания.
    expect(() => encodeCursor({ key: 'ключ', id: ID })).toThrow(TypeError)
  })

  it('ключ проверяется строго: в SQL уходит только форма timestamptz', () => {
    // Дальше ключ идёт в `::timestamptz`. Пропустить туда что угодно — значит менять
    // «покажем сначала» на пятисотку по ссылке из чужого письма.
    for (const bad of ['2026-08-18', 'now()', "2026-08-18 19:02:03.092835+00'; drop table", '2026-13-99 99:99:99+00 ']) {
      expect(decodeCursor(btoa(`${bad}~${ID}`))).toBeNull()
    }
    expect(decodeCursor(btoa(`2026-08-18 19:02:03+00~${ID}`))).toEqual({ key: '2026-08-18 19:02:03+00', id: ID })
  })

  it('второй разделитель — признак подделки, а не опечатки', () => {
    expect(decodeCursor(btoa(`${KEY}~${ID}~${ID}`))).toBeNull()
  })

  it('длина курсора ограничена: адрес приходит от кого угодно', () => {
    expect(decodeCursor('a'.repeat(513))).toBeNull()
  })

  it('разведчик берёт на строку больше показанного', () => {
    expect(probeLimit(20)).toBe(21)
    expect(takePage(Array.from({ length: 21 }, (_, i) => i), 20)).toEqual({
      items: Array.from({ length: 20 }, (_, i) => i),
      hasNext: true,
    })
    expect(takePage(Array.from({ length: 20 }, (_, i) => i), 20).hasNext).toBe(false)
  })

  describe('cursorHref', () => {
    it('переносит остальные параметры и меняет ровно курсор', () => {
      const href = cursorHref('/notifications', { unread: '1', after: 'старый' })
      expect(href('новый')).toBe('/notifications?unread=1&after=%D0%BD%D0%BE%D0%B2%D1%8B%D0%B9')
    })

    it('у начала ленты адрес ровно один — без параметра', () => {
      expect(cursorHref('/notifications', { after: 'что-то' })(null)).toBe('/notifications')
      expect(cursorHref('/notifications', {})(null)).toBe('/notifications')
    })

    it('шаг не тащит за собой встречный параметр', () => {
      // Иначе «назад» строился бы поверх оставшегося `?after=`, в адресе оказывались бы
      // оба, и страница пошла бы по тому, что разбирает первым, — то есть не туда, куда
      // написано на стрелке.
      expect(cursorHref('/n', { after: 'вниз' }, BEFORE_PARAM)('вверх')).toBe('/n?before=%D0%B2%D0%B2%D0%B5%D1%80%D1%85')
      expect(cursorHref('/n', { before: 'вверх' }, AFTER_PARAM)('вниз')).toBe('/n?after=%D0%B2%D0%BD%D0%B8%D0%B7')
    })
  })
})
