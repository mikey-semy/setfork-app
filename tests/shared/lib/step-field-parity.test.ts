import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { steps } from '@/shared/db'
import { toStepInput } from '@/shared/lib/step-input'
import type { ProposedItem } from '@/shared/db'

/**
 * ⚠️ ПРИ КОПИРОВАНИИ ШАГА НЕ ТЕРЯЕТСЯ НИ ОДНО ПОЛЕ МОДЕЛИ.
 *
 * Это узда на класс, а не на случай. Копий конвертера было ЧЕТЫРЕ — «использовать как
 * шаблон», форк, приём сгенерированного кандидата и перевод, — и каждая вела свой
 * список полей. Списки расходились молча и в опасную сторону: форк терял пометку
 * «разрушительный пункт», а без неё закомментированный `# make reset` собирается в
 * исполняемый `make reset`. Чинили дважды и оба раза дочиняли по одному полю.
 *
 * Набор полей берётся ИЗ СХЕМЫ, а не переписан рядом: иначе узда повторила бы ту же
 * ошибку, от которой стережёт, — свой список, который однажды отстанет от модели.
 * Новая колонка у шага ломает этот тест, пока её не назовут в одном из двух списков.
 */

/** Поля, которых в переносе быть НЕ должно, и почему. */
const NOT_CARRIED: Record<string, string> = {
  id: 'ключ строки: у копии он свой',
  versionId: 'копия принадлежит своей версии',
  n: 'нумерация выдаётся заново при записи',
  createdAt: 'время записи копии, а не оригинала',
  updatedAt: 'время записи копии, а не оригинала',
  // Транспорт до хранилища: у входа `imageKey`, у выхода `imageRef` — одно и то же.
  imageKey: 'на входе зовётся imageKey, на выходе imageRef',
  hasImage: 'вычисляется хранилищем по наличию imageRef',
}

/** Отличимое значение на каждое поле: пустое не докажет переноса. */
const SAMPLE: Record<string, unknown> = {
  blockId: '11111111-1111-1111-1111-111111111111',
  type: 'text',
  content: { md: 'тело блока' },
  title: { ru: 'Заголовок' },
  desc: { ru: 'Описание' },
  command: '# make reset',
  level: 'optional',
  why: { ru: 'Зачем' },
  needsHuman: true,
  needsHumanAsk: { ru: 'Сколько это стоит у вас?' },
  // ⚠️ Явный false на команде, которая ВЫГЛЯДИТ разрушительной: именно так автор
  // снимает ложную пометку. Перенос обязан уважать решение автора, а не переспрашивать
  // детектор — иначе копия вернёт пометку, которую человек снял руками.
  danger: false,
  section: { ru: 'Раздел' },
  subtasks: [{ ru: 'подшаг' }],
  refs: [{ label: { ru: 'ссылка' }, url: 'https://example.com' }],
}

describe('перенос полей шага', () => {
  const columns = Object.keys(getTableColumns(steps))

  it('⚠️ каждое поле модели либо переносится, либо названо в списке исключений', () => {
    const unknown = columns.filter((c) => !(c in NOT_CARRIED) && !(c in SAMPLE))
    expect(
      unknown,
      'у шага появилось поле, про которое перенос ничего не знает: назовите его в SAMPLE (переносится) или в NOT_CARRIED (с причиной)',
    ).toEqual([])
  })

  it('⚠️ общий конвертер доносит ВСЕ переносимые поля', () => {
    const [out] = toStepInput([{ ...SAMPLE, imageKey: 'k/1.png' } as unknown as ProposedItem]) as unknown as [
      Record<string, unknown>,
    ]
    for (const [field, value] of Object.entries(SAMPLE)) {
      expect(out[field], `поле ${field} потеряно при переносе`).toEqual(value)
    }
    expect(out.imageRef, 'картинка переезжает под именем imageRef').toBe('k/1.png')
    expect(out.n, 'нумерация выдаётся заново').toBe(1)
  })

  it('пустая пометка «разрушительный пункт» достаётся детектору, а заданная — нет', () => {
    // Тристейт: не задано — решает вид команды; задано (в т.ч. false) — решает автор.
    const [auto] = toStepInput([{ title: { ru: 'x' }, command: 'rm -rf /' } as unknown as ProposedItem])
    expect(auto.danger, 'без решения автора пометку ставит детектор').toBe(true)
    const [manual] = toStepInput([{ title: { ru: 'x' }, command: 'rm -rf /', danger: false } as unknown as ProposedItem])
    expect(manual.danger, 'решение автора сильнее детектора').toBe(false)
  })
})
