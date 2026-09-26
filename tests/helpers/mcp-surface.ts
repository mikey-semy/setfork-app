import { registerSurface } from '@/features/mcp/registry'

/**
 * Поверхность сервера MCP — то, что видит клиент: имена инструментов, сценариев и шаблонов
 * ресурсов. Собирается той же функцией, что зовёт маршрут (`registerSurface`), на заглушке
 * сервера — без сети и без базы.
 */
export function mcpSurface(): { tools: string[]; prompts: string[]; resourceTemplates: string[] } {
  const tools: string[] = []
  const prompts: string[] = []
  const resourceTemplates: string[] = []
  const server = {
    registerTool: (name: string) => tools.push(name),
    registerPrompt: (name: string) => prompts.push(name),
    registerResource: (_name: string, template: { uriTemplate: { toString(): string } }) => resourceTemplates.push(template.uriTemplate.toString()),
    server: { registerCapabilities: () => {}, setRequestHandler: () => {} },
  }
  registerSurface(server as unknown as Parameters<typeof registerSurface>[0])
  return { tools: tools.sort(), prompts: prompts.sort(), resourceTemplates: resourceTemplates.sort() }
}
