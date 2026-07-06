import 'server-only'
import { appOrigin } from './app-origin'

// Конфиг WebAuthn (RP = Relying Party = наш сайт). rpID — регистрируемый домен
// (без схемы/порта); origin проверяем строго. Оба — из доверенного env-origin
// (не из заголовков запроса, см. app-origin).
export const RP_NAME = 'SetFork'

export function rpID(): string {
  return process.env.WEBAUTHN_RP_ID || new URL(appOrigin()).hostname
}
export function expectedOrigin(): string {
  return appOrigin()
}

export const b64uFromBytes = (b: Uint8Array): string => Buffer.from(b).toString('base64url')
/** base64url → Uint8Array с ArrayBuffer-бэкингом (тип, который ждёт @simplewebauthn). */
export function bytesFromB64u(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s, 'base64url')
  const out = new Uint8Array(buf.byteLength)
  out.set(buf)
  return out
}
