import { Users, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { Tooltip } from '@/shared/ui/Tooltip'
import { addCollaborator, removeCollaborator } from './actions'
import type { CollaboratorRow } from './queries'

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
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-1.5 font-semibold text-ink">
        <Users size={16} className="text-ink-2" /> {t('collaboratorsHeading', lang)}
      </div>

      <form action={addCollaborator.bind(null, templateId)} className="mb-3 flex flex-wrap items-center gap-2">
        <input
          name="handle"
          placeholder={t('addCollaboratorPh', lang)}
          className="w-[220px] rounded-md border border-border bg-surface-2 px-3 py-2 text-[13.5px] text-ink outline-hidden focus:border-border-strong"
        />
        <Button type="submit" variant="primary" size="md">
          {t('addCollaborator', lang)}
        </Button>
      </form>

      {collaborators.length === 0 ? (
        <p className="text-[13px] text-muted">{t('noCollaborators', lang)}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {collaborators.map((c) => (
            <div key={c.userId} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
              <Avatar handle={c.handle} avatarUrl={c.avatarUrl} size={24} />
              <span className="text-[13.5px] font-medium text-ink">{c.handle}</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">{c.role}</span>
              <form action={removeCollaborator.bind(null, templateId, c.userId)} className="ml-auto">
                <Tooltip label={t('removeLabel', lang)}>
                  <button
                    className="inline-flex items-center gap-1 rounded p-1 text-muted hover:text-danger"
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
    </section>
  )
}
