import type { Context } from '@deepseek-ai/cordis'
import { EntryTree } from '@deepseek-ai/cordis-plugin-loader'

/** 组件的子条目只负责装配；用户开关由外层 profile 条目持久化。 */
class ComponentTree extends EntryTree {
  write(): void {}
}

export function defineComponent(moduleUrl: URL) {
  return {
    inject: ['loader'],
    async apply(ctx: Context): Promise<void> {
      // effect 等待异步初始化完成再清理，避免加载途中关闭组件后遗留子条目。
      await ctx.effect(async function* () {
        const tree = new ComponentTree(ctx)
        yield async () => {
          const fibers = [...tree.entries()].flatMap((entry) => (entry.fiber ? [entry.fiber] : []))
          tree.root.stop()
          await Promise.all(fibers.map((fiber) => fiber.await()))
        }
        await tree.root.update([{ id: 'implementation', name: moduleUrl.href }])
        const fiber = tree.store.implementation?.fiber
        if (!fiber) throw new Error(`无法加载组件：${moduleUrl.href}`)
        await fiber.await()
      }, 'rong-aio: component')
    },
  }
}
