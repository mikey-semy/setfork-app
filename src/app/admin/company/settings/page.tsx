import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { getAiSettings, hasApiKey } from '@/shared/settings/ai'
import { fetchModels } from '@/shared/ai/models'
import { buildOpts, withSavedOption } from '@/features/admin/model-options'
import { CouncilBlock, ReadinessBlock, SelfGenBlock } from '@/features/admin/CouncilFields'
import { setCompanySettings } from '@/features/admin/actions'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { FormSaveBar } from '@/shared/ui/FormSaveBar'
import { Alert } from '@/shared/ui/Alert'

export const metadata = { title: 'Company settings' }

/**
 * НАСТРОЙКИ КОМПАНИИ — как она работает: кого зовёт совет, сама ли пишет списки, при каких
 * условиях публикует без человека.
 *
 * Отдельная страница, а не секция /admin (решение владельца 2026-07-31): рубильники
 * автономии — не настройка инстанса вроде SMTP или S3. Пока они лежали внутри «Генерации и
 * моделей», их не находили, а сохранение половины формы переписывало другую.
 *
 * Три карточки = три решения разного веса: совет тратит деньги на КАЖДЫЙ запрос человека,
 * самогенерация — сама по расписанию, планка — публикует без человека. Заголовок страницы
 * живёт в шапке (TopNav), подзаголовков в проекте нет.
 */
export default async function CompanySettingsPage() {
  await requireAdmin()
  const [lang, settings, keyed] = await Promise.all([getLang(), getAiSettings(), hasApiKey()])
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)

  // Каталог моделей нужен только селекту моделей совета. Нет ключа — не ходим за ним вовсе:
  // fetchModels сам вернёт пустой каталог, но лишний сетевой поход на странице ни к чему.
  const models = keyed ? await fetchModels() : null
  const councilOpts = models
    ? withSavedOption(buildOpts(models.chat, false, lang, models.currency, models.pricesKnown), settings.chatModel)
    : []

  const v = {
    enabled: settings.councilEnabled,
    audience: settings.councilAudience,
    maxGnomes: settings.councilMaxGnomes,
    models: settings.councilModels.join(', '),
    webSeek: settings.councilWebSeek,
    clarify: settings.councilClarify,
    maxPerMonth: settings.councilMaxPerMonth,
    selfGenMode: settings.selfGenMode,
    selfGenPerDay: settings.selfGenPerDay,
    selfGenPerSweep: settings.selfGenPerSweep,
    readinessMode: settings.readinessMode,
    readinessMinSteps: settings.readinessMinSteps,
    readinessMinGrade: settings.readinessMinGrade,
    readinessPerDay: settings.readinessPerDay,
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-5 py-6 md:px-8">
      {!settings.enabled && (
        <Alert variant="warn" className="max-w-[860px]">
          {say(
            'AI is off for the whole instance — nothing below will run until you turn it on in Admin → Generation & models.',
            'ИИ выключен для всего инстанса — ничего из настроенного ниже не заработает, пока не включите его в Админке → Генерация и модели.',
          )}
        </Alert>
      )}

      {/* Одна форма на три карточки: сохранение общее, потому что и решение общее —
          «как теперь работает компания». Полоса сохранения липкая (FormSaveBar). */}
      <form action={setCompanySettings} className="flex flex-col gap-4">
        <SettingsSection title={say('Expert council', 'Совет экспертов')}>
          <CouncilBlock v={v} ru={ru} modelOptions={councilOpts} />
        </SettingsSection>

        <SettingsSection
          title={say('Self-generation', 'Самогенерация')}
          hint={say('The company writes lists on its own initiative, not only on request.', 'Компания пишет списки по своей инициативе, а не только по запросу.')}
        >
          <SelfGenBlock v={v} ru={ru} />
        </SettingsSection>

        <SettingsSection
          title={say('Readiness bar', 'Планка готовности')}
          hint={say('When a draft goes public without a human.', 'При каких условиях черновик уходит в паблик без человека.')}
        >
          <ReadinessBlock v={v} ru={ru} />
        </SettingsSection>

        <FormSaveBar ru={ru} />
      </form>
    </div>
  )
}
