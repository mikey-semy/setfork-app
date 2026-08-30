import { z } from 'zod'
import { mcpCheckStep, mcpReportRun, mcpStartRun } from '@/features/mcp/tools'
import { json, err, type ToolKit } from './kit'

/** Прогоны: старт и отметка шага. */
export function registerRuns({ readTool, writeTool }: ToolKit) {
  writeTool(
    'start_run',
    {
      title: 'Start a run',
      // Прогон — не «галочки для себя», а запись исполнения: по ней потом судят, работает
      // список или нет. Агенту это нужно знать ДО старта, иначе он отмечает шаги наугад.
      description:
        'Start (or resume your active) run of a list by ref — an execution record against the list\'s current version. Returns the run id, steps and progress. Report each step with check_step: the run is what later shows whether the list actually works.',
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
        'Report the outcome of a run step by its number (like a CI step). done true/false marks it passed/not; blocked true marks it failed, with reason for why. Report failures honestly: a run with an unreported failure claims the list works when it does not.',
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

  writeTool(
    'report_run',
    {
      title: 'Report a verification run',
      description:
        'Record a machine verification report for the version you just ran. The report belongs to that VERSION, not to the list: a later edit makes a new version, which starts with no reports. runId is REQUIRED and must belong to this list — a report without a run is a claim, not a fact. Failures are reported the same way as successes (verdict "fails"): "ran and failed" and "never ran" are different facts. A successful report raises the version to machine-run level, but never overwrites a higher human level. The response echoes reportedVersion and currentVersion; if they differ it also sets staleVersion — the list moved on while you were running, so your report vouches for the version you ran, not for what people see now.',
      inputSchema: {
        list: z.string().describe('List reference: "handle/slug" or just "slug"'),
        runId: z.string().describe('Run id from start_run — the report references a real, existing run'),
        task: z.string().describe('What exactly was verified, one line — the report names the checked thing, not "verified"'),
        environment: z
          .record(z.string(), z.string())
          .describe('Where it ran: {tool, os, node, ...}. Without it the report ages silently'),
        steps: z
          .array(
            z.object({
              n: z.number().int().min(1),
              status: z.enum(['pass', 'fail', 'skip']),
              note: z.string().optional(),
            }),
          )
          .describe('Per-step outcome'),
        verdict: z.enum(['works', 'works_with_caveats', 'fails']).describe('The verdict; it is shown verbatim and never shortened'),
        notes: z.string().optional().describe('Caveats in words — what "works with caveats" means here'),
      },
    },
    async (userId, args) => {
      const res = await mcpReportRun(userId, args)
      return 'error' in res ? err(res.error as string) : json(res)
    },
  )
}
