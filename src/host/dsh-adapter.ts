/** DSH 内部 Loader 探测适配：集中封装纤维活跃状态码与内部包查找。 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Cordis 纤程已初始化并处于运行态的状态码。 */
export const CORDIS_FIBER_ACTIVE = 2

/** 返回当前所有已启用且处于活跃状态的指定内部插件 Loader 条目。 */
export function findActiveEntries(ctx: Context, packageName: string) {
  return [...ctx.loader.entries()].filter(
    (entry) =>
      entry.options.name === packageName &&
      !entry.disabled &&
      entry.fiber?.state === CORDIS_FIBER_ACTIVE,
  )
}

/** 返回首个处于活跃状态的指定内部插件 Loader 条目。 */
export function findActiveEntry(ctx: Context, packageName: string) {
  return findActiveEntries(ctx, packageName)[0]
}
