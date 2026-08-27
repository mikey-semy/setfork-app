import { Users, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { Tooltip } from '@/shared/ui/Tooltip'
import { UserLine } from '@/shared/ui/UserLine'
import { addCollaborator, removeCollaborator } from './actions'
import type { CollaboratorRow } from './queries'
import { buttonClass } from '@/shared/ui/button-style'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'

/** Управление соавторами (только владелец; страница settings уже owner-gated). */
export function CollaboratorsSection({
  templateId,
  collaborators,
  lang,
}: {
  templateId: string
  collaborators: CollaboratorRow[]
  lang: Lang
}) {
  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-1.5">
          <Users size={16} className="text-ink-2" /> {t('collaboratorsHeading', lang)}
        </span>
      }
    >
      <form action={addCollaborator.bind(null, templateId)} className="mb-3 flex flex-wrap items-center gap-2">
        <Input name="handle"
          placeholder={t('addCollaboratorPh', lang)} className="w-menu" />
        <Button type="submit" variant="primary" size="md">
          {t('addCollaborator', lang)}
        </Button>
      </form>

      {collaborators.length === 0 ? (
        <p className="text-body text-muted">{t('noCollaborators', lang)}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {collaborators.map((c) => (
            <div key={c.userId} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
              <UserLine handle={c.handle} avatarUrl={c.avatarUrl} size="md" className="min-w-0" />
              <Badge variant="soft">{c.role}</Badge>
              <form action={removeCollaborator.bind(null, templateId, c.userId)} className="ml-auto">
                <Tooltip label={t('removeLabel', lang)}>
                  <button
                    type="submit"
                    className={buttonClass({ variant: 'danger', className: 'hover:text-danger' })}
                    aria-label={t('removeLabel', lang)}
                  >
                    <X size={15} />
                  </button>
                </Tooltip>
              </form>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  )
}
