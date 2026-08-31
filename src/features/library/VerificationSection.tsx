'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BadgeCheck } from 'lucide-react'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { buttonClass } from '@/shared/ui/button-style'
import { t, type Lang } from '@/shared/i18n'
import { setVerificationLevel, type HumanLevel } from './actions/verification'

/**
 * УРОВЕНЬ ПРОВЕРКИ ТЕКУЩЕЙ ВЕРСИИ — ставит тот, кто список ВЁЛ (решение 0018).
 *
 * Уровень относится к версии: правка создаёт новую, та рождается породой, и здесь это
 * сказано словами — иначе человек проставит «прошёл целиком», потом поправит опечатку и
 * решит, что метка пропала по ошибке.
 *
 * `machine_run` в выборе НЕТ: его ставит прогон. Руками он означал бы «машина
 * проверяла» там, где машина не проверяла.
 *
 * Окружение — свободная строка («Ubuntu 24.04, Caddy 2.8»): именно она отличает
 * «работало» от «работало у меня», и без неё метка стареет молча.
 */
const LEVELS: HumanLevel[] = ['rock', 'doc_checked', 'cut', 'crystal']

const LABEL: Record<HumanLevel, string> = {
  rock: 'verify.rock',
  doc_checked: 'verify.docChecked',
  cut: 'verify.cut',
  crystal: 'verify.crystal',
}

export function VerificationSection({
  templateId,
  level,
  env,
  version,
  lang,
}: {
  templateId: string
  level: string | null | undefined
  env: string | null | undefined
  version: number
  lang: Lang
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // ⚠️ ПОСТАВЛЕННОЕ ПРОГОНОМ не подставляем в выбор. `machine_run` в списке нет (его
  // ставит машина), и подстановка давала пустой триггер без подсказки, а Save отправлял
  // это значение обратно — действие отказывало, и автор видел «уровень может ставить
  // только автор или соавтор». Тупик из ШТАТНОГО состояния: после первого же прогона.
  // Поэтому машинный уровень показывается отдельной строкой, а выбор начинается с того,
  // что человек может поставить.
  const machine = level === 'machine_run'
  const [value, setValue] = useState<HumanLevel>(machine ? 'rock' : ((level as HumanLevel) ?? 'rock'))
  const [envText, setEnvText] = useState(env ?? '')
  const [failed, setFailed] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-1.5">
          <BadgeCheck size={16} className="text-ink-2" /> {t('verify.heading', lang)}
        </span>
      }
    >
      {/* Что именно метится — версия, а не список. Сказано до выбора, а не после. */}
      <p className="mb-3 text-body-sm text-muted">{t('verify.hint', lang).replace('{n}', String(version))}</p>

      {/* Машинный уровень стоит — говорим об этом прямо, а не подставляем в выбор.
          Иначе человек видит пустое поле и не понимает, что уровень вообще есть. */}
      {machine && (
        <Alert variant="info" className="mb-3">
          {t('verify.machineSet', lang)}
        </Alert>
      )}

      {failed && (
        <Alert variant="danger" className="mb-3">
          {failed === 'no-version' ? t('verify.errNoVersion', lang) : t('verify.errNotAllowed', lang)}
        </Alert>
      )}

      {/* Удачное сохранение выглядело В ТОЧНОСТИ как несохранение: ни подтверждения, ни
          обновления страницы. Человек жал ещё раз, чтобы убедиться. */}
      {saved && !pending && (
        <Alert variant="ok" className="mb-3">
          {t('verify.saved', lang)}
        </Alert>
      )}

      {/* Колонка на мобиле, ряд на широком: три контрола в строку на 390px не помещаются
          и превращаются в лесенку с обрезанными подписями. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={t('verify.levelLabel', lang)} className="sm:w-field">
          <Select value={value} onValueChange={(v) => setValue(v as HumanLevel)} disabled={pending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(LABEL[l] as Parameters<typeof t>[0], lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('verify.envLabel', lang)} className="min-w-0 flex-1">
          <Input
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={t('verify.envPh', lang)}
            maxLength={200}
            disabled={pending || value === 'rock'}
          />
        </Field>

        <button
          type="button"
          className={buttonClass({ variant: 'primary', className: 'max-sm:w-full' })}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setVerificationLevel(templateId, value, envText)
              const bad = 'error' in res ? res.error : null
              setFailed(bad)
              setSaved(!bad)
              // Метка и дата видны на самой странице списка — без обновления они остались
              // бы прежними, и «сохранено» противоречило бы тому, что человек видит.
              if (!bad) router.refresh()
            })
          }
        >
          {t('saveChanges', lang)}
        </button>
      </div>
    </SettingsSection>
  )
}
