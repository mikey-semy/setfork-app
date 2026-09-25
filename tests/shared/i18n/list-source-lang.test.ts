import { describe, expect, it } from 'vitest'
import { classifyListLang, isTitleForeign, listSourceLang } from '@/shared/i18n/detect-text-lang'

/**
 * ЯЗЫК ОРИГИНАЛА СПИСКА (ADR-0030): записанный главнее алфавита, а заполнение старых списков
 * пишет только то, в чём уверено.
 */
describe('listSourceLang', () => {
  it('записанный — как есть; нет — по алфавиту названия', () => {
    expect(listSourceLang('ru', { ru: 'Docker Compose' })).toBe('ru')
    expect(listSourceLang(null, { ru: 'Суп' })).toBe('ru')
    expect(listSourceLang(null, { en: 'Soup' })).toBe('en')
  })
})

describe('isTitleForeign — показывать ли «Перевести»', () => {
  it.each([
    // Ценность колонки: по алфавиту «Docker Compose» — английский, а автор записал русский.
    [{ ru: 'Docker Compose' }, 'ru', 'en', true],
    [{ ru: 'Суп' }, null, 'en', true],
    [{ ru: 'Суп', en: 'Soup' }, 'ru', 'en', false],
    // Неверный тег генерации: русский текст под `en` — русскому зрителю переводить нечего.
    [{ en: 'Суп' }, null, 'ru', false],
    [{ ru: 'Hallo' }, 'de', 'ru', false],
  ] as const)('%j, записан %s, зритель %s → %s', (title, stored, viewer, want) => {
    expect(isTitleForeign(title, stored, viewer)).toBe(want)
  })
})

describe('classifyListLang — заполнение пишет только уверенное', () => {
  it.each([
    [['Поставить веб-сервер', 'Нужен для раздачи статики и обратного прокси', 'sudo apt install nginx'], false, 'ru'],
    // Команда длиннее русского текста — кириллицы меньше трети: осторожно в спорные, не в `en`.
    [['Поставить nginx', 'sudo apt install nginx'], false, 'mixed'],
    [['Install Redis', 'Grab it from redis.io'], false, 'en'],
    // Английский с одной русской цитатой — кириллицы мало: смесь, а не русский.
    [['Run kubectl apply -f deployment.yaml --namespace production', 'Совет'], false, 'mixed'],
    // Кириллица не из русского алфавита и латиница с диакритикой — другие языки.
    [['Приготувати суп, додати їжу'], false, 'mixed'],
    [['Прыгатаваць суп, дадаць ўсё'], false, 'mixed'],
    [['Erbsensuppe über Nacht einweichen'], false, 'mixed'],
    // В первой версии два языка — копия переведённого списка, оригинал не определить.
    [['Install Redis', 'Поставить Redis'], true, 'mixed'],
    [['1', '—'], false, 'empty'],
  ] as const)('%j (несколько языков: %s) → %s', (texts, multiKey, want) => {
    expect(classifyListLang([...texts], multiKey)).toBe(want)
  })
})
