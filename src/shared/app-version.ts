/**
 * Семантическая версия приложения (`0.1.0`) — единственный человекочитаемый номер
 * версии для футера и баннера обновления. Инлайнится на сборке из package.json
 * через next.config `env` → NEXT_PUBLIC_APP_VERSION. Без node:fs — поэтому импортируется
 * и в клиентских компонентах (в отличие от shared/version.ts с build-id сборки).
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'
