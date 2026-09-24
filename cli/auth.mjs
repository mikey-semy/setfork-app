// Где sf хранит токен. Форма — как у `gh` (hosts.yml): файл на хост в каталоге настроек
// пользователя, права 600. Токен не печатается никогда — только «есть / нет» и хост.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Каталог настроек: $XDG_CONFIG_HOME/setfork или ~/.config/setfork (как у gh). */
export function configDir(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'setfork')
}
const hostsFile = (env) => join(configDir(env), 'hosts.json')

function readHosts(env) {
  try {
    return JSON.parse(readFileSync(hostsFile(env), 'utf8'))
  } catch {
    return {}
  }
}

/** Токен для хоста: SETFORK_TOKEN главнее файла (CI, разовые вызовы) — как GH_TOKEN у gh. */
export function tokenFor(host, env = process.env) {
  if (env.SETFORK_TOKEN) return { token: env.SETFORK_TOKEN.trim(), source: 'SETFORK_TOKEN' }
  const t = readHosts(env)[host]?.token
  return t ? { token: t, source: hostsFile(env) } : null
}

export function saveToken(host, token, env = process.env) {
  const file = hostsFile(env)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const hosts = readHosts(env)
  hosts[host] = { token }
  writeFileSync(file, JSON.stringify(hosts, null, 2) + '\n', { mode: 0o600 })
  // writeFileSync не меняет права уже существующего файла — ставим явно.
  chmodSync(file, 0o600)
  return file
}

export function removeToken(host, env = process.env) {
  const file = hostsFile(env)
  if (!existsSync(file)) return false
  const hosts = readHosts(env)
  if (!hosts[host]) return false
  delete hosts[host]
  writeFileSync(file, JSON.stringify(hosts, null, 2) + '\n', { mode: 0o600 })
  return true
}
