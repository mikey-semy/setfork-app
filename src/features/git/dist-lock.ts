import 'server-only'
import { createHash } from 'node:crypto'
import { getPool } from '@/shared/db'
import { captureError } from '@/shared/observability'

// Кросс-инстансный лок на операции над одним репозиторием через Postgres
// advisory-локи. In-proc-лока (store.withLock) недостаточно при >1 инстансе,
// делящих общий том GIT_DATA_DIR: две реплики могут одновременно писать в один
// bare-репо и повредить его. Advisory-лок сериализует их через общую БД.
//
// Включается флагом GIT_DISTRIBUTED_LOCK=1 (для мульти-инстансного TS-пути).
// По умолчанию выключен — single-instance dev не платит за лишний round-trip.
// Прод обычно работает через Rust-ядро (у него свой pg advisory-лок).

const ENABLED = process.env.GIT_DISTRIBUTED_LOCK === '1'

/** uuid/строка → стабильный signed int64 ключ для pg_advisory_lock. */
function lockKey(id: string): string {
  return createHash('sha1').update(id).digest().readBigInt64BE(0).toString()
}

/** Выполнить fn под session-level advisory-локом (если включён). lock+unlock
 *  идут по одному выделенному соединению; при падении процесса PG снимет лок сам. */
export async function withDistLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn()
  const key = lockKey(id)
  const client = await getPool().connect()
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [key])
    return await fn()
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [key])
    } catch (e) {
      captureError(e, { where: 'withDistLock.unlock', id })
    }
    client.release()
  }
}
