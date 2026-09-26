import { openApiDocument } from './document'

/** OpenAPI 3.1 публичных машинных адресов списка — см. `document.ts`. */
export const dynamic = 'force-static'

export function GET() {
  return Response.json(openApiDocument(), { headers: { 'Access-Control-Allow-Origin': '*' } })
}
