import 'server-only'
import { headers } from 'next/headers'

// Канонический origin приложения для ССЫЛОК В ПИСЬМАХ и любых доверенных URL.
// Берём ТОЛЬКО из env (APP_URL / NEXT_PUBLIC_SITE_URL) — НИКОГДА из заголовков
// запроса: x-forwarded-host подделывается и приводит к password-reset poisoning
// (письмо с настоящим токеном, но ссылкой на сайт атакующего).
export function appOrigin(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

/** IP клиента для rate-limit внутри server actions (заголовки прокси Traefik/dokploy). */
export async function clientIpFromHeaders(): Promise<string> {
  const h = await headers()
  const xff = h.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return h.get('x-real-ip') ?? 'unknown'
}
