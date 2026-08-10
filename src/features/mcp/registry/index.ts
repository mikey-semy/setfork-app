import { registerCheckTools } from './checks'
import { registerGnomeTools } from './gnomes'
import { makeToolKit } from './kit'
import { registerListTools } from './lists'
import { registerReadTools } from './reads'
import { registerRunTools } from './runs'
import { registerSourceTools } from './sources'
import { registerSuggestionTools } from './suggestions'

/**
 * Весь набор инструментов MCP — ОДНИМ вызовом.
 *
 * Список регистраторов живёт здесь, а не в маршруте: иначе появляется способ
 * потерять инструменты молча — забыл дописать вызов рядом с шестью соседними, и
 * клиент просто не увидит части набора. Тест `registry.test.ts` зовёт эту же
 * функцию и сверяет состав, поэтому пропажа падает в CI, а не у агента.
 */
export function registerAllTools(server: { registerTool: unknown }) {
  const kit = makeToolKit(server)
  registerReadTools(kit)
  registerGnomeTools(kit)
  registerListTools(kit)
  registerSuggestionTools(kit)
  registerCheckTools(kit)
  registerSourceTools(kit)
  registerRunTools(kit)
}
