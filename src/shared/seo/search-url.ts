import { SITE_ORIGIN } from '@/shared/site'

/**
 * Адрес поиска по сайту с подстановкой — ОДИН на все машинные описания поиска.
 *
 * Его читают двое: `SearchAction` в JSON-LD (поисковик предлагает поле поиска по сайту) и
 * OpenSearch (`/opensearch.xml`: браузер ищет по SetFork из адресной строки). Имя
 * подстановки у них своё по стандарту (`{search_term_string}` против `{searchTerms}`),
 * адрес — общий: разъедься он, одно из описаний вело бы на пустую выдачу.
 */
export const siteSearchUrl = (placeholder: string) => `${SITE_ORIGIN}/search?q=${placeholder}`
