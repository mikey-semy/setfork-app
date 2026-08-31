import { CheckCircle2, AlertTriangle, XCircle, Bot, User } from 'lucide-react'
import { plural, t, type Lang } from '@/shared/i18n'
import { envLine } from './verification-report'

/**
 * СТРОКА ОТЧЁТА О ПРОГОНЕ на странице списка (спека прохода 5, §5).
 *
 * `Прогнан 12.09 · Claude Code 2.x · 9/9 шагов · работает` — и ссылка на полный отчёт.
 *
 * ⚠️ ВЕРДИКТ НЕ СОКРАЩАЕТСЯ. «Работает с оговорками» остаётся собой: сжать его до
 * «работает» — то же враньё, что метка без предмета, и правило 4 спеки запрещает это
 * прямо. Поэтому у каждого вердикта своя подпись и свой знак, а не «галочка/крестик».
 *
 * ⚠️ ПРОГОН АГЕНТОМ ПОМЕЧЕН КАК ПРОГОН АГЕНТОМ (правило 5): человек и машина проверяют
 * разное, и выдать одно за другое — значит завысить утверждение.
 */
const VERDICT = {
  works: { icon: CheckCircle2, tone: 'text-accent', key: 'report.works' },
  works_with_caveats: { icon: AlertTriangle, tone: 'text-warn', key: 'report.worksWithCaveats' },
  fails: { icon: XCircle, tone: 'text-danger', key: 'report.fails' },
} as const

export type ReportLineData = {
  id: string
  kind: 'machine' | 'manual'
  verdict: keyof typeof VERDICT
  task: string
  environment: Record<string, string>
  steps: { n: number; status: 'pass' | 'fail' | 'skip' }[]
  createdAt: Date | string
}

export function RunReportLine({ report, lang }: { report: ReportLineData; lang: Lang }) {
  const look = VERDICT[report.verdict]
  const Icon = look.icon
  const KindIcon = report.kind === 'machine' ? Bot : User
  const passed = report.steps.filter((s) => s.status === 'pass').length
  const when = new Date(report.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')
  // ⚠️ ТЕМ ЖЕ ПОСТРОИТЕЛЕМ, что сохранял метку. `Object.values` по `jsonb` печатал
  // окружение в порядке, который выбирает Postgres (по длине ключа, потом побайтово), —
  // строка расходилась с `verified_env` на той же странице и могла меняться от запроса к
  // запросу. Одно окружение — один способ его показать.
  const env = envLine(report.environment)

  // ⚠️ БЕЗ ССЫЛКИ. Строка вела на `/versions` — историю коммитов, где про отчёты нет
  // ничего. Ссылка «не туда» хуже её отсутствия: человек кликает и теряет место. Когда
  // появится страница отчётов, ссылка вернётся вместе с ней.
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-ink-2">
      <span className={`inline-flex items-center gap-1.5 ${look.tone}`}>
        <Icon size={14} />
        {t(look.key as Parameters<typeof t>[0], lang)}
      </span>
      <span className="text-muted">·</span>
      <span className="inline-flex items-center gap-1.5">
        <KindIcon size={13} className="text-muted" />
        {t(report.kind === 'machine' ? 'report.byMachine' : 'report.byHuman', lang)}
      </span>
      <span className="text-muted">·</span>
      <span>{when}</span>
      {env && (
        <>
          <span className="text-muted">·</span>
          {/* Окружение обрезается, а не переносится: на 390px оно иначе рвёт строку. */}
          <span className="min-w-0 truncate">{env}</span>
        </>
      )}
      <span className="text-muted">·</span>
      <span>
        {passed}/{report.steps.length} {plural(report.steps.length, 'steps', lang)}
      </span>
    </div>
  )
}
