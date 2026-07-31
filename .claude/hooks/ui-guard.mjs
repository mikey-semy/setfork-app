// Стопор самопального UI для агентных сессий (решение владельца 31.07.2026,
// трек HQ ui-system Ф7). PreToolUse-хук на Edit/Write: если в features/app/
// widgets пишется сырой контрол со стилями вместо примитива shared/ui —
// запись блокируется с подсказкой. Дополняет линтовую узду: хук ловит В МОМЕНТ
// письма, линт — в CI.
let raw = ''
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  let out = null
  try {
    const j = JSON.parse(raw || '{}')
    const p = String(j.tool_input?.file_path ?? '').replace(/\\/g, '/')
    const text = [j.tool_input?.content, j.tool_input?.new_string].filter(Boolean).join('\n')
    const inScope =
      /src\/(features|app|widgets)\//.test(p) &&
      /\.(tsx|jsx)$/.test(p) &&
      !/(UiKitGallery|admin\/ui-kit)/.test(p)
    if (inScope && text) {
      const findings = []
      for (const m of text.matchAll(/<input\b[^>]*/g)) {
        const t = m[0]
        if (/type=["'](checkbox|radio|hidden|file|range|color)/.test(t)) continue
        if (/className=/.test(t) && /(border|rounded|bg-surface|text-\[)/.test(t))
          findings.push('сырой <input> со стилями — используй Input (+Field) из @/shared/ui')
      }
      for (const m of text.matchAll(/<textarea\b[^>]*/g)) {
        if (/className=/.test(m[0]) && /(border|rounded|bg-surface)/.test(m[0]))
          findings.push('сырая <textarea> со стилями — используй Textarea из @/shared/ui')
      }
      if (/<select\b/.test(text)) findings.push('нативный <select> запрещён — используй Select из @/shared/ui/select')
      for (const m of text.matchAll(/<button\b[^>]*/g)) {
        const t = m[0]
        if (/className=/.test(t) && /(bg-primary|h-\[3[0-9]px\]|border border-border)/.test(t))
          findings.push('рукописная кнопка — используй Button/SubmitButton из @/shared/ui')
      }
      for (const m of text.matchAll(/<(Link|a)\b[^>]*/g)) {
        const t = m[0]
        if (/className=/.test(t) && /bg-primary/.test(t) && !/h-\[38px\]/.test(t))
          findings.push('Link-кнопка вне единого рецепта (h-[38px] text-[14px] px-3.5, см. Ф3)')
      }
      if (/border border-border bg-surface-2 px-/.test(text))
        findings.push('самопальная рамка поля (рецепт FIELD_BOX) — используй Input/Textarea/control.ts')
      if (findings.length) {
        const uniq = [...new Set(findings)]
        out = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              `Самопальный UI (трек ui-system): ${uniq.join('; ')}. ` +
              'СНАЧАЛА посмотри src/shared/ui (эталон — /admin/ui-kit) и каталог shadcn ' +
              '(HQ research/2026-07-31-ui-system.md §3). Нет подходящего примитива — добавь его в shared/ui и в галерею, а не инлайн. ' +
              'Легитимное исключение — оформи через существующий примитив с className или обсуди с владельцем.',
          },
        }
      }
    }
  } catch {
    /* битый вход — не блокируем */
  }
  if (out) process.stdout.write(JSON.stringify(out))
  process.exit(0)
})
