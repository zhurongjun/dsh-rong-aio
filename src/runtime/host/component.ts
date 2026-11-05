/** 组件装配层：用独立 Loader 子树连接功能入口与客户端清单，不保存业务状态。 */

import type { Context } from '@deepseek-ai/cordis'
import { EntryTree } from '@deepseek-ai/cordis-plugin-loader'

/**
 * 只读装配子树：内部 implementation 条目随外层功能创建与释放。
 * write 刻意为空，阻止生成条目污染用户覆盖文件；启停状态由外层 profile 保存。
 */
class ComponentTree extends EntryTree {
  /** 子树是装配产物，禁止写入用户覆盖层；启停持久化归外层功能条目。 */
  write(): void {}
}

/**
 * 创建 Cordis 功能入口。moduleUrl 指向带内部清单的组件宿主文件。
 * 异步加载与释放由 effect 成对管理，初始化期间停用也不会遗留子条目。
 */
export function defineComponent(moduleUrl: URL) {
  return {
    inject: ['loader'],

    /** 挂载唯一实现条目并等待就绪；加载失败向 Cordis 传播，释放时等待子纤程结束。 */
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
