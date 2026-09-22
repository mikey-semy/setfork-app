import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Узда: каждая точка входа в редактор берёт превью картинок ОДНИМ способом.
//
// Ключ картинки лежит в двух разных полях — у шага `imageKey`, у блока-картинки
// `content.ref`, — и вывод этого списка расползался по страницам. Без превью
// редактор рисует пустой слот вместо загруженной картинки, то есть человек читает
// «картинку потеряли». Ловушку находили ТРИЖДЫ и трижды чинили в месте находки:
// на странице правки списка, на применении канона текстом, — а соседние входы
// оставались с прежним поведением, и каждый по отдельности выглядел верным.
//
// Поэтому проверяется не «превью где-то передаются», а что НИ ОДИН вызов
// `toEditorItems` не берёт их иначе, чем через `getItemPreviews`. Пятая точка входа
// упадёт здесь, а не на глазах у человека.

const SRC = 'src'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

/** Вызовы `toEditorItems(...)` в проекте: файл + текст вызова. */
function editorItemsCalls(): { file: string; call: string }[] {
  return sourceFiles(SRC).flatMap((file) => {
    const src = readFileSync(file, 'utf8')
    // Вызов целиком до конца строки: во всех точках входа он однострочный, а
    // многострочный вызов оборвётся и не притворится проверенным.
    return [...src.matchAll(/toEditorItems\(.*$/gm)]
      .map((m) => ({ file, call: m[0] }))
      .filter(({ call }) => !call.startsWith('toEditorItems(items: ')) // объявление функции
  })
}

describe('превью картинок редактора выводятся одним способом', () => {
  it('вызовы toEditorItems в проекте есть — иначе узда проверяет пустоту', () => {
    expect(editorItemsCalls().length).toBeGreaterThan(0)
  })

  it('каждый вызов берёт превью через getItemPreviews', () => {
    const wrong = editorItemsCalls()
      .filter(({ call }) => !call.includes('getItemPreviews'))
      .map(({ file, call }) => `${file}: ${call.trim()}`)
    expect(wrong).toEqual([])
  })
})
