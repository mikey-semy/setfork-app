// Liveness-проба для Docker HEALTHCHECK / балансировщика. Быстрая, без БД.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true })
}
