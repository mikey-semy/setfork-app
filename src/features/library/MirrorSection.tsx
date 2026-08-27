import { AlertCircle, CheckCircle2, RefreshCw, Unplug } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Field } from '@/shared/ui/Field'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { disableMirror, mirrorNow, saveMirror } from './mirror-actions'
import { MIRROR_HELP_AFTER_ATTEMPTS, mirrorRetryDueAt } from './mirror-policy'
import { MirrorCheckButton } from './MirrorCheckButton'
import { mirrorErrorText } from './mirror-error'

/** Настройки списка → Зеркало (Ф3): push-копия на GitHub/GitLab.
 *  Пушит ядро после каждой версии; здесь URL + токен (шифруется, повторно не
 *  показывается) и статус последнего пуша — ошибка видна, а не глотается. */
export function MirrorSection({
  templateId,
  url,
  hasToken,
  syncedAt,
  error,
  attempts,
  lang,
}: {
  templateId: string
  url: string | null
  hasToken: boolean
  syncedAt: Date | null
  error: string | null
  /** Ф2: сколько пушей подряд не удалось (счётчик ведёт ядро). */
  attempts: number
  lang: Lang
}) {
  const save = saveMirror.bind(null, templateId)
  const sync = mirrorNow.bind(null, templateId)
  const disable = disableMirror.bind(null, templateId)
  const configured = !!url
  // Ф2: повторы идут в обоих случаях, меняется только текст. Границу берём из
  // модуля политики, а не повторяем число здесь: разъехавшись, интерфейс начал
  // бы называть временным сбоем то, что давно им не является.
  const longFailing = attempts >= MIRROR_HELP_AFTER_ATTEMPTS

  return (
    <SettingsSection title={t('mirrorTitle', lang)} hint={t('mirrorIntro', lang)}>
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
          <div className="flex min-w-0 items-start gap-2 text-body">
            {error ? (
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
            ) : (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
            )}
            <div className="min-w-0">
              <div className="text-ink-2">
                {error ? t('mirrorFailed', lang) : syncedAt ? t('mirrorOk', lang) : t('mirrorNever', lang)}
                {syncedAt && (
                  <span className="text-muted"> · {syncedAt.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                )}
              </div>
              {/* Код отказа от ядра переводится, вывод git показывается как есть. */}
              {error && <div className="mt-0.5 break-words text-danger">{mirrorErrorText(error, lang)}</div>}
              {/* Что будет дальше. Без этой строки красная ошибка читается как
                  тупик, хотя повтор уже назначен, — и владелец идёт чинить то,
                  что чинится само. Перенос по словам: на 360px текст «повторы
                  прекращены…» занимает три строки и не имеет права распирать
                  секцию (min-w-0 у родителя + break-words здесь). */}
              {error && (
                <div className="mt-0.5 break-words text-muted">
                  {longFailing ? (
                    t('mirrorNeedsOwner', lang)
                  ) : (
                    <>
                      {t('mirrorWillRetry', lang)}
                      <span className="hidden sm:inline">
                        {' · '}
                        {mirrorRetryDueAt(attempts, syncedAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <FormSaveBar lang={lang} />
      </form>

      {/* Вторичные действия — ОТДЕЛЬНЫМИ формами, не formAction той же формы
          (P1 Codex по #612): «Синхронизировать» отправлял главную форму, и
          FormSaveBar считал отправку сохранением — гасил полосу, хотя правки
          URL/токена никуда не ушли (mirrorNow поля игнорирует). */}
      {configured && (
        // flex-wrap: на 360px три кнопки в ряд не помещаются, и перенос обязан
        // быть предусмотрен, а не случиться. Результат проверки — своей строкой
        // на всю ширину (Alert внутри кнопки-компонента).
        <div className="mt-4 flex flex-wrap items-center justify-end gap-4">
          {/* Проверка доступа рядом с синхронизацией, но своей кнопкой: она
              ничего не пушит и не трогает статус — путать их нельзя. */}
          <MirrorCheckButton templateId={templateId} lang={lang} />
          <form action={disable}>
            <Tooltip label={t('mirrorDisable', lang)}>
              <Button type="submit" size="sm" variant="ghost" aria-label={t('mirrorDisable', lang)}>
                <Unplug size={15} />
              </Button>
            </Tooltip>
          </form>
          <form action={sync}>
            <Tooltip label={t('mirrorSyncNow', lang)}>
              <Button type="submit" size="sm" variant="ghost" aria-label={t('mirrorSyncNow', lang)}>
                <RefreshCw size={15} />
                <span className="hidden md:inline">{t('mirrorSyncNow', lang)}</span>
              </Button>
            </Tooltip>
          </form>
        </div>
      )}
    </SettingsSection>
  )
}
