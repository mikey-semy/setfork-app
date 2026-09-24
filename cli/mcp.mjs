// Вызов инструментов SetFork по MCP (Streamable HTTP, JSON-RPC). Один контракт с агентами:
// те же права токена, те же лимиты, те же тексты отказов — своего REST у sf нет.

/** Тело ответа MCP: JSON или поток SSE (`data: {...}`) — берём последний JSON-объект. */
export function parseRpcBody(body) {
  const t = String(body).trim()
  if (t.startsWith('{')) return JSON.parse(t)
  const datas = t
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean)
  if (!datas.length) throw new Error('empty response from the server')
  return JSON.parse(datas[datas.length - 1])
}

/** Ответ инструмента → {ok, text, data}. Текст отказа сервера — как есть: он называет причину. */
export function toolResult(rpc) {
  if (rpc.error) return { ok: false, text: rpc.error.message ?? JSON.stringify(rpc.error) }
  const res = rpc.result ?? {}
  const text = (res.content ?? []).map((c) => c.text ?? '').join('\n')
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    /* отказ — строкой */
  }
  return { ok: !res.isError, text, data }
}

export function mcpClient({ base, token, fetchImpl = fetch }) {
  const url = `${base}/api/mcp`
  let id = 0
  const post = async (method, params) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    })
    if (res.status === 401) throw new Error('not authorized — run `sf auth login` (the token is missing, wrong or revoked)')
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    return parseRpcBody(await res.text())
  }
  let ready = null
  return {
    async call(name, args = {}) {
      ready ??= post('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sf', version: '0.2.0' } })
      await ready
      return toolResult(await post('tools/call', { name, arguments: args }))
    },
  }
}
