import { t, type Lang } from '@/shared/i18n'

/** Где ключ: файл автора, номер шага или мета списка (шаг 0 без файла). */
export const secretWhere = (step: string, lang: Lang, path?: string): string =>
  path
    ? t('fileWhere', lang).replace('{path}', path)
    : step === '0'
      ? t('secretWhereMeta', lang)
      : t('secretWhereStep', lang).replace('{n}', step)
