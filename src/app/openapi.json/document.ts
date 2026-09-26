import { LOCALES } from '@/shared/i18n'
import { SCRIPT_DIALECTS, dialectMime } from '@/core/domain/script-dialect'
import { BADGE_KINDS } from '@/features/badges/svg'
import { PROBLEM_JSON } from '@/shared/http/problem'

/**
 * OPENAPI 3.1 — ПУБЛИЧНЫЕ МАШИННЫЕ АДРЕСА СПИСКА.
 *
 * Описывает то, что читает чужой код: данные, скрипт, экспорт, скилл, фид релизов, бандл,
 * бейдж и встраивание. Внутренние ручки интерфейса (`/api/*` для нашего же фронта) сюда
 * НЕ входят: у них нет внешних потребителей и нет обещания стабильности.
 *
 * Перечни — из кода, а не копией: виды бейджа (`BADGE_KINDS`), диалекты скрипта
 * (`SCRIPT_DIALECTS`), языки (`LOCALES`). Полноту держит `tests/app/openapi.test.ts`:
 * каждый путь документа — существующий маршрут, каждый машинный маршрут — в документе или
 * в перечне исключений с причиной.
 */

const path = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: { type: 'string' } })
const LIST_PARAMS = [path('handle', 'Owner handle'), path('slug', 'List slug')]
const skillRef = {
  name: 'ref',
  in: 'query',
  required: false,
  description:
    'A release tag (`v0.7.0`) or a list version (`v3`): the steps and files of that version instead of the current one. A release tag wins over a version number, as in git. Unknown ref — 404',
  schema: { type: 'string' },
}
const langQuery = { name: 'lang', in: 'query', required: false, description: 'Requested content language; without it — the viewer cookie and Accept-Language. Without a translation the original is served, and the envelope `lang` names the language actually served (`requestedLang` — the one asked for)', schema: { type: 'string', enum: [...LOCALES] } }

const problem = (description: string) => ({ description, content: { [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/Problem' } } } })
const NOT_FOUND = { '404': problem('No such list, or it is not visible to you — the same answer for both') }
const RATE_LIMITED = {
  '429': {
    ...problem('Too many requests'),
    headers: { 'Retry-After': { description: 'Seconds to wait', schema: { type: 'integer' } } },
  },
}
const INVALID_TOKEN = { '401': problem('The API token is invalid, expired or revoked') }
/** Отказ `raw`: по умолчанию — скрипт диалекта (тело уходит в интерпретатор), по `Accept` — Problem Details. */
const scriptContent = () => Object.fromEntries(SCRIPT_DIALECTS.map((d) => [dialectMime(d).split(';')[0], { schema: { type: 'string' } }]))
const rawRefusal = (description: string) => ({
  description: `${description}. A refusal script by default; Problem Details with \`Accept: application/problem+json\``,
  content: { ...scriptContent(), [PROBLEM_JSON]: { schema: { $ref: '#/components/schemas/Problem' } } },
})
const ok = (description: string, mime: string, schema: object = { type: 'string' }) => ({ '200': { description, content: { [mime]: { schema } } } })

/**
 * Режим ремонта отвечает 503 ДО обработчика (middleware), поэтому у каждого пути — один и
 * тот же ответ, дописанный при сборке, а не копией в каждом. Тело — не Problem Details:
 * скриптам и архивам — текст, остальным — страница (см. `middleware.ts`).
 */
const MAINTENANCE = {
  description: 'Maintenance mode: answered before the endpoint, retry after Retry-After',
  headers: { 'Retry-After': { description: 'Seconds to wait', schema: { type: 'integer' } } },
  content: { 'text/plain': { schema: { type: 'string' } }, 'text/html': { schema: { type: 'string' } } },
}

type Paths = Record<string, { get: { responses: Record<string, unknown> } & Record<string, unknown> }>
const withMaintenance = (paths: Paths): Paths =>
  Object.fromEntries(Object.entries(paths).map(([p, item]) => [p, { get: { ...item.get, responses: { ...item.get.responses, '503': MAINTENANCE } } }]))

export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SetFork public list API',
      version: '1',
      description:
        'Machine-readable surfaces of a SetFork list. Errors from these endpoints are RFC 9457 Problem Details (`application/problem+json`) with a stable machine code in the `error` field (`raw` and `embed` differ, see them). While the site is in maintenance mode, every endpoint answers 503 before reaching the handler: plain text for scripts and archives, an HTML page otherwise; retry after `Retry-After`. The MCP server (`/api/mcp`) and git smart HTTP are described by their own protocols.',
    },
    // Относительный адрес: документ отдаётся статически, и адрес, вшитый при сборке, на
    // стенде без своего build-arg указывал бы на прод. `/` — тот хост, с которого документ взят.
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'SetFork API token (the same one MCP uses); read scope is enough' } },
      schemas: {
        Problem: {
          type: 'object',
          description: 'RFC 9457 Problem Details',
          required: ['type', 'title', 'status', 'error'],
          properties: {
            type: { type: 'string', const: 'about:blank' },
            title: { type: 'string', description: 'HTTP status phrase' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            error: { type: 'string', description: 'Machine code, stable (e.g. not_found, invalid_token, rate_limited)' },
            retryAfter: { type: 'integer', description: 'Seconds to wait (429 only)' },
          },
        },
      },
    },
    paths: withMaintenance({
      '/{handle}/{slug}/data.json': {
        get: {
          summary: 'The list as data',
          parameters: [...LIST_PARAMS, langQuery],
          security: [{}, { bearer: [] }],
          responses: { ...ok('Data envelope', 'application/json', { type: 'object' }), '304': { description: 'Not modified (ETag)' }, ...INVALID_TOKEN, ...NOT_FOUND, ...RATE_LIMITED },
        },
      },
      '/{handle}/{slug}/raw': {
        get: {
          summary: 'The list as a runnable script',
          description:
            'Refusals come as a script in the requested dialect by default (the body is piped into an interpreter). Send `Accept: application/problem+json` to get Problem Details instead; the reason is also in the `SF-Reason` header.',
          parameters: [
            ...LIST_PARAMS,
            {
              name: 'lang',
              in: 'query',
              required: false,
              // Перечня нет намеренно: адрес принимает и псевдонимы (`powershell`, `pwsh`, `python`),
              // а незнакомое значение — как `sh`. Строгий клиент с enum отвергал бы рабочие адреса.
              description: `Script dialect: ${SCRIPT_DIALECTS.join(', ')} (aliases: powershell, pwsh → ps1; python → py). Anything else means sh.`,
              schema: { type: 'string', default: 'sh' },
            },
            { name: 'bid', in: 'query', required: false, description: 'Only these blocks (repeatable)', schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true },
            { name: 'bids', in: 'query', required: false, description: 'Only these blocks, comma-separated', schema: { type: 'string' } },
          ],
          security: [{}, { bearer: [] }],
          responses: {
            '200': { description: 'Script', content: scriptContent() },
            '304': { description: 'Not modified (ETag)' },
            '401': rawRefusal('The API token is invalid, expired or revoked'),
            '404': rawRefusal('No such list or block'),
            '406': rawRefusal('No script in this dialect: the steps carry shell commands'),
            '429': { ...rawRefusal('Too many requests'), headers: RATE_LIMITED['429'].headers },
          },
        },
      },
      '/{handle}/{slug}/export': {
        get: {
          summary: 'Download the list as Markdown or HTML',
          parameters: [...LIST_PARAMS, { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['md', 'html'], default: 'md' } }],
          responses: { '200': { description: 'Document', content: { 'text/markdown': { schema: { type: 'string' } }, 'text/html': { schema: { type: 'string' } } } }, ...NOT_FOUND },
        },
      },
      '/{handle}/{slug}.md': {
        get: {
          summary: 'The list as Markdown (same as export?format=md)',
          parameters: LIST_PARAMS,
          responses: { ...ok('Markdown', 'text/markdown'), ...NOT_FOUND },
        },
      },
      '/{handle}/{slug}/SKILL.md': {
        get: { summary: 'The list as an Agent Skill, one file', parameters: [...LIST_PARAMS, skillRef], responses: { ...ok('SKILL.md', 'text/markdown'), ...NOT_FOUND } },
      },
      '/{handle}/{slug}/skill.tar.gz': {
        get: {
          summary: 'The list as an Agent Skill folder',
          parameters: [...LIST_PARAMS, skillRef],
          responses: { ...ok('Archive', 'application/gzip', { type: 'string', format: 'binary' }), ...NOT_FOUND },
        },
      },
      '/{handle}/{slug}/blob': {
        get: {
          summary: 'One file of an Agent Skill (scripts/, references/, assets/) as plain text',
          description:
            'Served as `text/plain` with `nosniff` and a sandbox CSP whatever the file is: the list author writes it. A 503 with Problem Details (`core_unavailable`) means the files could not be read right now; retry.',
          parameters: [
            ...LIST_PARAMS,
            { name: 'path', in: 'query', required: true, description: 'File path in the skill, e.g. `scripts/run.sh`', schema: { type: 'string' } },
            { name: 'v', in: 'query', required: false, description: 'List version; the current one by default', schema: { type: 'integer', minimum: 1 } },
          ],
          responses: {
            ...ok('File', 'text/plain'),
            '400': problem('No `path` given'),
            '404': problem('No such list (or not visible to you), or no such file in that version'),
          },
        },
      },
      '/{handle}/{slug}/releases.atom': {
        get: { summary: 'Release notes as an Atom feed', parameters: LIST_PARAMS, responses: { ...ok('Feed', 'application/atom+xml'), ...NOT_FOUND } },
      },
      '/{handle}/{slug}/repo.bundle': {
        get: {
          summary: 'Git bundle of the whole version history',
          parameters: LIST_PARAMS,
          responses: { ...ok('Bundle', 'application/octet-stream', { type: 'string', format: 'binary' }), ...NOT_FOUND, '500': problem('The bundle could not be built') },
        },
      },
      '/{handle}/{slug}/badge/{kind}': {
        get: {
          summary: 'Badge (SVG) with a list counter',
          parameters: [...LIST_PARAMS, { name: 'kind', in: 'path', required: true, description: 'Counter, optionally with `.svg`', schema: { type: 'string', enum: BADGE_KINDS.flatMap((k) => [k, `${k}.svg`]) } }],
          responses: { ...ok('Badge', 'image/svg+xml'), '304': { description: 'Not modified (ETag)' }, '404': problem('Unknown badge kind, or no such public list') },
        },
      },
      '/{handle}/{slug}/embed': {
        get: {
          summary: 'The list as an embeddable HTML page (for an iframe)',
          description: 'Refusals are an HTML page, not Problem Details: an iframe shows them to a person.',
          parameters: LIST_PARAMS,
          responses: { ...ok('Page', 'text/html'), '304': { description: 'Not modified (ETag)' }, '404': { description: 'No such public list', content: { 'text/html': { schema: { type: 'string' } } } } },
        },
      },
    }),
  }
}
