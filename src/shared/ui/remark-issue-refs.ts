// remark-плагин: превращает `#N` в ссылку на issue (base/N), не трогая код и уже-ссылки.

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[]; [k: string]: unknown }

/** Разбивает текст на узлы: обычный текст + link для каждого `#N` (граница слова). */
export function splitRefs(value: string, base: string): MdNode[] {
  const re = /(^|[^\w#])#(\d+)\b/g
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    const pre = m[1]
    const num = m[2]
    const hashAt = m.index + pre.length
    if (hashAt > last) out.push({ type: 'text', value: value.slice(last, hashAt) })
    out.push({ type: 'link', url: `${base}/${num}`, children: [{ type: 'text', value: `#${num}` }] })
    last = m.index + m[0].length
  }
  if (out.length === 0) return [{ type: 'text', value }]
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

/** remark-плагин (attacher для unified/react-markdown). `base` — префикс URL issue. */
export function remarkIssueRefs(base: string) {
  const walk = (node: MdNode) => {
    if (!node.children) return
    const next: MdNode[] = []
    for (const child of node.children) {
      // текст вне ссылки → разбиваем на ref-ссылки; код (inlineCode/code) детей не имеет — не трогаем
      if (child.type === 'text' && node.type !== 'link') {
        next.push(...splitRefs(child.value ?? '', base))
      } else {
        walk(child)
        next.push(child)
      }
    }
    node.children = next
  }
  // attacher: () => transformer
  return () => (tree: MdNode) => walk(tree)
}
