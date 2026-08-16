import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListStepCard } from '@/app/[handle]/[slug]/ListStepCard'
import { TooltipProvider } from '@/shared/ui/Tooltip'

describe('печатная команда шага', () => {
  it('скрывает экранную строку со скроллом и печатает весь shell-код через CodeCard', () => {
    const command = 'if command -v jq; then\n  jq --version\nfi'
    const { container } = render(
      <TooltipProvider>
        <ListStepCard
          step={{
            id: 'step-1',
            n: 1,
            title: { en: 'Install jq' },
            desc: { en: '' },
            why: { en: '' },
            command,
            subtasks: [],
            refs: [],
          } as never}
          number="1"
          tpl={{ id: 'list-1' } as never}
          base="/miki/example"
          viewer={null}
          readOnlyView={false}
          isOwner={false}
          digSteps={new Set()}
          stepImages={{}}
          mon={{ linkTracking: false } as never}
          lang="en"
        />
      </TooltipProvider>,
    )

    const printCard = container.querySelector('.sf-code-card')
    const printWrapper = printCard?.parentElement
    const screenCommand = Array.from(container.querySelectorAll('div')).find(
      (el) => el.className.includes('print:hidden') && el.textContent?.includes(command),
    )

    expect(screenCommand).toBeDefined()
    expect(printWrapper?.className).toContain('hidden')
    expect(printWrapper?.className).toContain('print:block')
    expect(printCard?.textContent).toContain('1if command -v jq; then')
    expect(printCard?.textContent).toContain('2  jq --version')
    expect(printCard?.textContent).toContain('3fi')
    expect(printCard?.querySelector('.hljs-keyword')).not.toBeNull()
  })
})
