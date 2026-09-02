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
 * ⚠️ ЭТО ВТОРАЯ КОПИЯ ДОКУМЕНТА, И ОНА ОБЯЗАТЕЛЬНА. Клиент спрашивает сначала адрес С
 * ПУТЁМ ресурса (`/.well-known/oauth-protected-resource/api/mcp`) и только потом
 * корневой. Отдаём один и тот же документ из общего места — расходиться нечему.
 */
export const GET = protectedResourceHandler({ authServerUrls: [AUTH_ISSUER], resourceUrl: MCP_RESOURCE })

/** Браузерные клиенты спрашивают преflight перед метаданными. */
export const OPTIONS = metadataCorsOptionsRequestHandler()
