import { t, type Lang, type TKey } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'

/** Исходы записи файлов автора: код в адресе (`?e=`) → вид и текст. */
const NOTICE: Record<string, { variant: 'danger' | 'warn'; key: TKey }> = {
  'files-bad': { variant: 'danger', key: 'draftFilesBad' },
  'files-invalid': { variant: 'danger', key: 'draftFilesInvalid' },
  'files-unsupported': { variant: 'danger', key: 'draftFilesUnsupported' },
  'files-not-applied': { variant: 'warn', key: 'draftFilesNotApplied' },
}

/**
 * Что случилось с файлами при сохранении или публикации: отказ до записи (версии нет,
 * черновик цел) либо версия без них. `detail` — текст ядра, он называет файл и предел.
 */
export function FilesPublishNotice({ e, detail, lang }: { e?: string; detail?: string; lang: Lang }) {
  const n = e ? NOTICE[e] : undefined
  if (!n) return null
  return (
    <Alert variant={n.variant} className="mb-4">
      <span className="block">{t(n.key, lang).replace('{detail}', detail ?? '')}</span>
    </Alert>
  )
}
