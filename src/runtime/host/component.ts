import type { Context } from '@deepseek-ai/cordis'
import { EntryTree } from '@deepseek-ai/cordis-plugin-loader'

class ComponentTree extends EntryTree {
  commit(): void {}
}

export function defineComponent(moduleUrl: URL) {
  return {
    inject: ['loader'],

    async apply(ctx: Context): Promise<void> {
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
