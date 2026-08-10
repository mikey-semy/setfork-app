import { z } from 'zod'
import { mcpCheckStep, mcpStartRun } from '@/features/mcp/tools'
import { err, json, type ToolKit } from './kit'

/** Прогоны: старт и отметка шага. */
export function registerRunTools({ readTool, writeTool }: ToolKit) {
  writeTool(
    'start_run',
    {
      title: 'Start a run',
      description: 'Start (or resume your active) run of a list by ref — a personal pass to track progress. Returns the run id, steps and progress.',
      inputSchema: {
        handle: z.string().describe('Owner handle'),
        slug: z.string().describe('List slug'),
      },
    },
    async (userId, { handle, slug }) => {
      const res = await mcpStartRun(userId, handle, slug)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )

  writeTool(
    'check_step',
    {
      title: 'Check off a run step',
      description:
        'Report the outcome of a run step by its number (like a CI step). done true/false marks it passed/not; blocked true marks it failed with an optional reason. Omit all to toggle done. Returns the updated run.',
      inputSchema: {
        runId: z.string().describe('The run id'),
        step: z.number().int().min(1).describe('Step number (1-based)'),
        done: z.boolean().optional().describe('true = done, false = not done'),
        blocked: z.boolean().optional().describe('true = this step failed / could not be completed'),
        reason: z.string().optional().describe('Why it failed (used with blocked)'),
      },
    },
    async (userId, { runId, step, done, blocked, reason }) => {
      const res = await mcpCheckStep(userId, runId, step, { done, blocked, reason })
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )
}
