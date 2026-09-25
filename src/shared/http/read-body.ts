/**
 * Прочитать тело запроса, не дав ему превысить потолок.
 *
 * Заголовку `Content-Length` верим только для БЫСТРОГО отказа: он позволяет не
 * читать заведомо большое тело вовсе. Но полагаться на него нельзя — клиент вправе
 * слать `Transfer-Encoding: chunked`, и тогда заголовка нет совсем, а соврать в
 * нём может кто угодно. Поэтому считаем и байты по мере чтения.
 *
 * `null` — тело больше потолка; что с этим делать, решает вызывающий (git отвечает
 * 413, приёмник отчётов CSP молча пропускает).
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null

  const stream = req.body
  if (!stream) return Buffer.alloc(0)
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      // Обрываем НА превышении, а не после: весь смысл потолка в том, чтобы
      // лишние байты не оказались в памяти.
      if (total > maxBytes) return null
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks)
}
