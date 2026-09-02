import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler'
import { AUTH_ISSUER, MCP_RESOURCE } from '@/shared/auth/oauth-meta'

/**
 * Документ защищённого ресурса (RFC 9728).
 *
 * Наш 401 и раньше отдавал `WWW-Authenticate` со ссылкой сюда — а по ссылке был 404.
 * Клиент узнавал, куда идти, приходил и не находил ничего: в документации Anthropic
 * этот случай описан дословно как «Claude never learns where your authorization
 * server is». Отсюда и невозможность подключить SetFork с телефона.
 *
 * Адрес указываем явно, а не выводим из запроса: за прокси `req.url` — внутренний, и
 * `resource` перестал бы совпадать с тем, что вводит человек.
 */
export const GET = protectedResourceHandler({ authServerUrls: [AUTH_ISSUER], resourceUrl: MCP_RESOURCE })

/** Браузерные клиенты спрашивают преflight перед метаданными. */
export const OPTIONS = metadataCorsOptionsRequestHandler()
