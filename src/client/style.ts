import type { Context } from '@deepseek-ai/cordis'

/** 在 document.head 挂载组件样式，并在 Cordis 作用域释放时清理。 */
export function mountStyle(ctx: Context, pluginId: string, cssText: string): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = pluginId
    style.textContent = cssText
    document.head.append(style)
    return () => style.remove()
  }, `${pluginId}: styles`)
}
