import { Sparkles } from 'lucide-react'
import { ProvenancePanel } from '@/shared/ui/ProvenancePanel'
import type { ListLineage as Lineage } from '@/features/library/lineage'
import { type Lang } from '@/shared/i18n'
import { SectionLabel } from '@/shared/ui/SectionLabel'

/**
 * РОДОСЛОВНАЯ СПИСКА на странице самого списка — «почему он такой».
 *
 * Раньше это объяснение жило под кандидатом в чате генерации: человек уходил со страницы, и
 * оно исчезало. А главный вопрос про список задают ПОЗЖЕ («откуда это взялось?»), и отвечать
 * надо там, где список читают.
 *
 * Отвергнутые варианты показаны рядом намеренно: это единственное место, где видно цену
 * витка — за него заплачено, а внешне от него осталось только одно.
 */
export function ListLineage({ lineage, exact, gnomeNames, lang }: { lineage: Lineage; exact: boolean; gnomeNames?: Record<string, string>; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  return (
    <div className="mt-4 border-t border-border pt-3">
      <SectionLabel className="mb-2 flex items-center gap-1.5">
        <Sparkles size={12} /> {say('How this list came to be', 'Как появился этот список')}
      </SectionLabel>
      <p className="text-[12px] text-muted [overflow-wrap:anywhere]">
        {say('Request', 'Запрос')}: “{lineage.query}”
      </p>
      {!exact && (
        <p className="mt-1 text-[11.5px] text-muted">
          {say(
            'The exact variant was not recorded back then — the details below may describe a sibling variant.',
            'Какой именно вариант приняли, тогда не записывалось — детали ниже могут относиться к соседнему варианту.',
          )}
        </p>
      )}
      <ProvenancePanel provenance={lineage.provenance} gnomeNames={gnomeNames} lang={lang} />
      {lineage.rejected.length > 0 && (
        <div className="mt-2">
          <span className="text-[11.5px] font-semibold text-ink-2">{say('Not chosen', 'Не выбрали')}:</span>
          <ul className="mt-1 flex flex-col gap-1">
            {lineage.rejected.map((r) => (
              <li key={r.idx} className="min-w-0 text-[12px] text-muted [overflow-wrap:anywhere]">
                {r.title || say('(untitled variant)', '(вариант без названия)')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
