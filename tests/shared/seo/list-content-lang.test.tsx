import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListStepCard } from '@/app/[handle]/[slug]/ListStepCard'
import { listJsonLd } from '@/app/[handle]/[slug]/list-jsonld'
import { TooltipProvider } from '@/shared/ui/Tooltip'

/**
 * ЯЗЫК СОДЕРЖИМОГО НА СТРАНИЦЕ СПИСКА (ADR-0029, WCAG 3.1.2 «язык частей»).
 *
 * Языка в адресе нет, и робот без `Accept-Language` видит английскую обвязку. Русский список
 * обязан объявить себя русским сам: в разметке (`inLanguage`) и у самого текста (`lang`).
 * ⚠️ `lang` — у ТЕКСТА, а не у всей области: надписи интерфейса вокруг («Why:») остаются на
 * языке зрителя, иначе диктор читает их чужим голосом (находка ревью по линзам — первая
 * редакция оборачивала шаги целиком). И у каждого поля — ЕГО язык: шаг, дописанный после
 * перевода, бывает на другом языке, чем соседние.
 */
const RU = { title: { ru: 'Гороховый суп' }, desc: { ru: 'Сытно' }, tags: [] }

describe('разметка страницы списка', () => {
  it('русский список без перевода при английском интерфейсе — inLanguage ru во всех блоках с языком', () => {
    const ld = listJsonLd({
      tpl: RU,
      owner: 'miki',
      slug: 'sup',
      lang: 'en',
      steps: [{ n: 1, title: { ru: 'Замочить горох' } }],
      howToSteps: [{ n: 1, title: { ru: 'Замочить горох' }, desc: { ru: 'На ночь' } }],
    })
    const byType = Object.fromEntries(ld.map((d) => [d['@type'], d]))
    for (const type of ['CreativeWork', 'ItemList', 'HowTo']) expect(byType[type], type).toMatchObject({ inLanguage: 'ru' })
  })

  it('HowTo — только когда передан набор шагов инструкции', () => {
    const ld = listJsonLd({ tpl: RU, owner: 'miki', slug: 'sup', lang: 'en', steps: [], howToSteps: null })
    expect(ld.map((d) => d['@type'])).not.toContain('HowTo')
  })
})

function card(step: Record<string, unknown>, lang: 'en' | 'ru') {
  return render(
    <TooltipProvider>
      <ListStepCard
        step={{ id: 's1', n: 1, desc: {}, why: {}, command: '', subtasks: [], refs: [], ...step } as never}
        number="1"
        tpl={{ id: 'l1' } as never}
        base="/miki/sup"
        viewer={null}
        readOnlyView={false}
        isOwner={false}
        digSteps={new Set()}
        stepImages={{}}
        mon={{ linkTracking: false } as never}
        lang={lang}
      />
    </TooltipProvider>,
  ).container
}

describe('язык текста шага', () => {
  it('поля на своём языке, надпись интерфейса — нет', () => {
    const c = card({ title: { ru: 'Замочить горох' }, why: { ru: 'Иначе не разварится' }, subtasks: [{ ru: 'Горох набух' }] }, 'en')
    const tagged = (text: string) => [...c.querySelectorAll('[lang]')].find((el) => el.textContent === text)?.getAttribute('lang')
    expect(tagged('Замочить горох')).toBe('ru')
    expect(tagged('Иначе не разварится')).toBe('ru')
    expect(tagged('Горох набух')).toBe('ru')
    // «Why:» — надпись интерфейса: ни она, ни её предки внутри карточки не помечены русским.
    const label = [...c.querySelectorAll('span')].find((el) => el.textContent === 'Why:')
    expect(label?.closest('[lang="ru"]')).toBeNull()
  })

  it('у каждого поля — его язык: переведённое название и не переведённый дописанный «зачем»', () => {
    const c = card({ title: { ru: 'Суп', en: 'Soup' }, why: { ru: 'Сытно' } }, 'en')
    expect([...c.querySelectorAll('[lang]')].find((el) => el.textContent === 'Soup')?.getAttribute('lang')).toBe('en')
    expect([...c.querySelectorAll('[lang]')].find((el) => el.textContent === 'Сытно')?.getAttribute('lang')).toBe('ru')
  })
})
