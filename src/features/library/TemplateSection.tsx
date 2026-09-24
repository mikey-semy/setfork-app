'use client'

import { Bot, LayoutTemplate } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { setListSkill, setListTemplate } from './actions'
import { ListFlagSection } from './ListFlagSection'

/** Настройки списка → «Шаблон»: включает кнопку «Use this template»
 *  (копия текущей версии БЕЗ fork-связи — стартовая точка для своих списков). */
export function TemplateSection({ templateId, isTemplate, lang }: { templateId: string; isTemplate: boolean; lang: Lang }) {
  return (
    <ListFlagSection
      icon={<LayoutTemplate size={15} className="text-muted" />}
      title={t('templateListTitle', lang)}
      hint={t('templateListHint', lang)}
      checked={isTemplate}
      save={(v) => setListTemplate(templateId, v)}
      failedText={t('listFlagFailed', lang)}
    />
  )
}

/** Настройки списка → «Скилл»: метка у имени, фильтр `is:skill`, блок файлов на странице. */
export function SkillSection({ templateId, isSkill, lang }: { templateId: string; isSkill: boolean; lang: Lang }) {
  return (
    <ListFlagSection
      icon={<Bot size={15} className="text-muted" />}
      title={t('skillListTitle', lang)}
      hint={t('skillListHint', lang)}
      checked={isSkill}
      save={(v) => setListSkill(templateId, v)}
      failedText={t('listFlagFailed', lang)}
    />
  )
}
