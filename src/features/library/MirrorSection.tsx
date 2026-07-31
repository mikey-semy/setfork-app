import { AlertCircle, CheckCircle2, RefreshCw, Unplug } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Field } from '@/shared/ui/Field'
import { disableMirror, mirrorNow, saveMirror } from './mirror-actions'

const card = 'rounded-lg border border-border bg-surface p-5'

/** Настройки списка → Зеркало (Ф3): push-копия на GitHub/GitLab.
 *  Пушит ядро после каждой версии; здесь URL + токен (шифруется, повторно не
 *  показывается) и статус последнего пуша — ошибка видна, а не глотается. */
export function MirrorSection({
  templateId,
  url,
  hasToken,
  syncedAt,
  error,
  lang,
}: {
  templateId: string
  url: string | null
  hasToken: boolean
  syncedAt: Date | null
  error: string | null
  lang: Lang
}) {
  const save = saveMirror.bind(null, templateId)
  const sync = mirrorNow.bind(null, templateId)
  const disable = disableMirror.bind(null, templateId)
  const configured = !!url

  return (
    <section className={card}>
      <div className="mb-1 font-semibold text-ink">{t('mirrorTitle', lang)}</div>
      <p className="mb-4 text-[13px] text-ink-2">{t('mirrorIntro', lang)}</p>

      <form action={save} className="flex flex-col gap-4">
        <Field label={t('mirrorUrlLabel', lang)}>
          <Input
            name="url"
            type="url"
            required
            pattern="https://.+/.+"
            defaultValue={url ?? ''}
            placeholder="https://github.com/user/my-list"
          />
        </Field>
        <Field label={t('mirrorTokenLabel', lang)} hint={t('mirrorTokenHint', lang)}>
          <Input
            name="token"
            type="password"
            autoComplete="off"
            required={!hasToken}
            placeholder={hasToken ? t('mirrorTokenSaved', lang) : 'ghp_…'}
          />
        </Field>

        {/* Статус последнего пуша: иконка + время; текст ошибки — полностью,
            это главный канал диагностики (никакой молчаливой деградации). */}
        {configured && (
          <div className="flex min-w-0 items-start gap-2 text-[13px]">
            {error ? (
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
            ) : (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
            )}
            <div className="min-w-0">
              <div className="text-ink-2">
                {error ? t('mirrorFailed', lang) : syncedAt ? t('mirrorOk', lang) : t('mirrorNever', lang)}
                {syncedAt && (
                  <span className="text-ink-3"> · {syncedAt.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                )}
              </div>
              {error && <div className="mt-0.5 break-words text-danger">{error}</div>}
            </div>
          </div>
        )}

        {/* Правый нижний угол — эталон секций: один ряд, одна высота, текст
            только на md+; вторичные действия — иконки с тултипом и aria. */}
        <div className="flex items-center justify-end gap-2">
          {configured && (
            <>
              <Tooltip label={t('mirrorDisable', lang)}>
                <Button
                  type="submit"
                  formAction={disable}
                  formNoValidate
                  size="sm"
                  variant="ghost"
                  aria-label={t('mirrorDisable', lang)}
                >
                  <Unplug size={15} />
                </Button>
              </Tooltip>
              <Tooltip label={t('mirrorSyncNow', lang)}>
                <Button
                  type="submit"
                  formAction={sync}
                  formNoValidate
                  size="sm"
                  variant="ghost"
                  aria-label={t('mirrorSyncNow', lang)}
                >
                  <RefreshCw size={15} />
                  <span className="hidden md:inline">{t('mirrorSyncNow', lang)}</span>
                </Button>
              </Tooltip>
            </>
          )}
          <SubmitButton>
            {t('saveChanges', lang)}
          </SubmitButton>
        </div>
      </form>
    </section>
  )
}
