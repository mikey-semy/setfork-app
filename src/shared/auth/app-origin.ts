import 'server-only'
import { headers } from 'next/headers'
import { DEV_ORIGIN, SITE_ORIGIN } from '@/shared/site'

// Канонический origin приложения для ССЫЛОК В ПИСЬМАХ и любых доверенных URL.
// Берём ТОЛЬКО из env (APP_URL / NEXT_PUBLIC_SITE_URL) — НИКОГДА из заголовков
// запроса: x-forwarded-host подделывается и приводит к password-reset poisoning
// (письмо с настоящим токеном, но ссылкой на сайт атакующего).
//
// Это ЕДИНСТВЕННЫЙ серверный источник адреса: раньше те же три env читали ещё
// пятнадцать мест, каждое со своим дефолтом. Дефолт здесь один и зависит от среды —
// в проде канон (`shared/site.ts`), в разработке localhost, иначе dev-письма звали бы
// на прод.
export function appOrigin(): string {
  const fromEnv = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return process.env.NODE_ENV === 'production' ? SITE_ORIGIN : DEV_ORIGIN
}

/** Хост приложения без схемы — для мест, где нужен домен, а не ссылка. */
export function appHost(): string {
  return appOrigin().replace(/^https?:\/\//, '')
}

/** IP клиента для rate-limit внутри server actions (заголовки прокси Traefik/dokploy). */
export async function clientIpFromHeaders(): Promise<string> {
  const h = await headers()
  const xff = h.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return h.get('x-real-ip') ?? 'unknown'
}
