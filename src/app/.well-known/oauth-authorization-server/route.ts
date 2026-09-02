import { NextResponse } from 'next/server'
import { metadataCorsOptionsRequestHandler } from 'mcp-handler'
import { AUTH_ISSUER, OAUTH_SCOPES } from '@/shared/auth/oauth-meta'

/**
 * Метаданные сервера авторизации (RFC 8414).
 *
 * ⚠️ `code_challenge_methods_supported: ["S256"]` — НЕ УКРАШЕНИЕ. Без этого поля клиент
 * ОБЯЗАН отказаться по спецификации, даже если всё остальное на месте: он не может
 * доказать, что PKCE поддержан, и не рискует отправлять код.
 *
 * ⚠️ ОПОЗНАНИЕ КЛИЕНТА БЕЗ РЕГИСТРАЦИИ. Claude приходит без заранее выданного
 * идентификатора, поэтому объявляем `client_id_metadata_document_supported` вместе с
 * методом `none`: клиент публичный, секрета у него нет и быть не может — на телефоне
 * его негде хранить. Это и есть та пара, без которой подключение упирается в «неизвестный
 * клиент».
 *
 * ⚠️ ЭТОТ ДОКУМЕНТ ЖИВЁТ НА ТОМ ЖЕ ORIGIN, ЧТО И ВЕСЬ САЙТ, и это известный риск: клиент
 * может решить, что через OAuth идут и остальные адреса домена (жалоба 26.08.2026).
 * Смягчение — точный `resource` в документе защищённого ресурса: он называет ровно
 * `/api/mcp`, а не origin целиком. Проверено, что прочее API продолжает отвечать по
 * своим правилам.
 */
export function GET() {
  return NextResponse.json(
    {
      issuer: AUTH_ISSUER,
      authorization_endpoint: `${AUTH_ISSUER}/oauth/authorize`,
      token_endpoint: `${AUTH_ISSUER}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      scopes_supported: [...OAUTH_SCOPES],
      service_documentation: `${AUTH_ISSUER}/docs`,
    },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } },
  )
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
