import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

const CORDIS_FIBER_ACTIVE = 2

export function findActiveEntries(ctx: Context, packageName: string) {
  return [...ctx.loader.entries()].filter(
    (entry) =>
      entry.options.name === packageName &&
      !entry.disabled &&
      entry.fiber?.state === CORDIS_FIBER_ACTIVE,
  )
}

export function findActiveEntry(ctx: Context, packageName: string) {
  return findActiveEntries(ctx, packageName)[0]
}
