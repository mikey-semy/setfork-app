import 'server-only'

/** Порт git одним местом — как в actions.ts: россыпь импортов рвёт базовый файл boundaries. */
export async function gitPort() {
  const [core, ports] = await Promise.all([
    // eslint-disable-next-line boundaries/dependencies -- git-порт: тот же кросс-фич-паттерн, что в actions.ts
    import('@/features/git/core'),
    import('@/core'),
  ])
  return { gitCore: core.gitCore, BranchOpError: ports.BranchOpError }
}
