import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Идентификатор сборки — для детекта «вкладка устарела после деплоя» (UpdateBanner).
 * После деплоя старые вкладки шлют Server Actions по протухшим id и ловят
 * UnrecognizedActionError; сравнение build-id клиента с сервером ловит это ДО клика.
 */

let cached: string | undefined

/** env → BUILD_ID сборки → 'dev'. Вынесено чистой функцией ради тестов. */
export function resolveBuildId(env: string | undefined, readBuildFile: () => string): string {
  const fromEnv = env?.trim()
  if (fromEnv) return fromEnv
  try {
    const fromFile = readBuildFile().trim()
    if (fromFile) return fromFile
  } catch {
    // next dev не пишет BUILD_ID — это и есть сигнал «dev».
  }
  return 'dev'
}

export function getBuildId(): string {
  cached ??= resolveBuildId(process.env.SETFORK_BUILD_SHA, () => readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8'))
  return cached
}
