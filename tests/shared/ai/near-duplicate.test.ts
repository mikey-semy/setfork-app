import { describe, expect, it } from 'vitest'
import { findNearDuplicate, jaccard, listText, shingles, wordSet, NEAR_DUP_THRESHOLD } from '@/shared/ai/near-duplicate'

// Почти-дубли — главный риск массовой генерации: «Как испечь хлеб дома» и «Печём хлеб дома
// своими руками» с теми же шагами другими словами это ОДИН список, а дедуп по заголовку его
// пропускает. Тесты держат границу «тот же список» / «та же тема, другой список»: слишком
// строгий порог заблокирует нормальные варианты (закваска ≠ дрожжи), слишком мягкий пустит
// клонов. Числа в тестах — измеренные (см. таблицу калибровки в модуле), не подогнанные.

const bread = {
  title: 'Как испечь хлеб дома',
  items: ['Смешать муку воду соль дрожжи', 'Замесить тесто до гладкости', 'Дать подняться два часа', 'Сформовать буханку', 'Испечь при 240 градусах'],
}
const breadReworded = {
  title: 'Печём хлеб дома своими руками',
  items: ['Смешайте муку с водой солью и дрожжами', 'Вымешивайте тесто пока не станет гладким', 'Оставьте подниматься на два часа', 'Сформуйте буханку', 'Выпекайте при 240 градусах'],
}
const sourdough = {
  title: 'Хлеб на закваске без дрожжей',
  items: ['Вывести закваску за пять дней', 'Освежить закваску утром', 'Смешать закваску с мукой и водой', 'Складывать тесто каждый час', 'Холодная ферментация в холодильнике', 'Печь на камне с паром'],
}
const deploy = {
  title: 'Деплой на VPS',
  items: ['Создать пользователя без root', 'Настроить ssh по ключу', 'Поставить docker', 'Поднять reverse proxy', 'Включить автообновления'],
}

describe('меры сходства', () => {
  it('пустой текст: набор пуст, сходство ноль', () => {
    expect(wordSet('').size).toBe(0)
    expect(jaccard(wordSet(''), wordSet('что-то'))).toBe(0)
  })

  it('регистр, пунктуация и словоформы различием не считаются', () => {
    expect(jaccard(wordSet('Замесить тесто до гладкости'), wordSet('замесите, тесто — до гладкости!'))).toBe(1)
  })

  it('порядок шагов не важен — мера по словам, а не по позициям', () => {
    const a = listText({ title: 'Хлеб', items: ['Замесить тесто', 'Испечь буханку'] })
    const b = listText({ title: 'Хлеб', items: ['Испечь буханку', 'Замесить тесто'] })
    expect(jaccard(wordSet(a), wordSet(b))).toBe(1)
  })

  it('фразовая мера глуха к перефразу — потому и не она решает', () => {
    const phrases = jaccard(shingles(listText(bread)), shingles(listText(breadReworded)))
    expect(phrases).toBeLessThan(0.1)
  })

  it('короткий текст всё равно сравним (шингл = сам текст)', () => {
    expect(shingles('Купить хлеб').size).toBe(1)
  })
})

describe('поиск почти-дубля', () => {
  it('переписанный другими словами — ДУБЛЬ (то, что дедуп по заголовку пропускает)', () => {
    const v = findNearDuplicate(breadReworded, [{ id: 'a', ...bread }])
    expect(v.match?.id).toBe('a')
    expect(v.match!.score).toBeGreaterThanOrEqual(NEAR_DUP_THRESHOLD)
    // Фразовая улика при перефразе низкая — значит это переписали, а не скопировали.
    expect(v.match!.phrases).toBeLessThan(0.2)
  })

  it('копия слово-в-слово — и совпадение, и высокая фразовая улика', () => {
    const v = findNearDuplicate(bread, [{ id: 'a', ...bread }])
    expect(v.match).toMatchObject({ id: 'a', score: 1, phrases: 1 })
  })

  it('та же тема, но ДРУГОЙ список — не дубль (иначе заблокируем нормальные варианты)', () => {
    const v = findNearDuplicate(sourdough, [{ id: 'a', ...bread }])
    expect(v.match).toBeNull()
    expect(v.best).toBeGreaterThan(0) // сходство есть, но ниже порога — и это видно в журнале
    expect(v.best).toBeLessThan(NEAR_DUP_THRESHOLD)
  })

  it('другая тема — ни совпадения, ни сходства', () => {
    expect(findNearDuplicate(deploy, [{ id: 'a', ...bread }])).toMatchObject({ match: null, best: 0 })
  })

  it('выбирается БЛИЖАЙШИЙ из нескольких', () => {
    const v = findNearDuplicate(breadReworded, [{ id: 'far', ...deploy }, { id: 'near', ...bread }, { id: 'mid', ...sourdough }])
    expect(v.match?.id).toBe('near')
  })

  it('сравнивать не с чем — пустой вердикт, а не ошибка', () => {
    expect(findNearDuplicate(bread, [])).toMatchObject({ match: null, best: 0 })
  })

  it('порог поднимается вызовом, но дефолт один на систему', () => {
    expect(findNearDuplicate(breadReworded, [{ id: 'a', ...bread }], 0.99).match).toBeNull()
  })

  it('найденное совпадение не отменяется более похожим-но-ниже-порога кандидатом', () => {
    // Порядок кандидатов не должен решать: сначала совпавший, потом «просто похожий».
    const v = findNearDuplicate(breadReworded, [{ id: 'dup', ...bread }, { id: 'topic', ...sourdough }])
    expect(v.match?.id).toBe('dup')
  })
})
