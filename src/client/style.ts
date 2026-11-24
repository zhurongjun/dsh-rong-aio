import type { Context } from '@deepseek-ai/cordis'
import baseCss from './base.css'

let baseUsers = 0
let baseStyle: HTMLStyleElement | undefined

/** 在 document.head 引用计数挂载全局共享样式与组件样式，全部组件停用后自动清理。 */
export function mountStyle(ctx: Context, pluginId: string, cssText: string): void {
  ctx.effect(() => {
    if (baseUsers++ === 0) {
      baseStyle = document.createElement('style')
      baseStyle.dataset.plugin = 'dsh-rong-aio:base'
      baseStyle.textContent = baseCss
      document.head.append(baseStyle)
    }
    const style = document.createElement('style')
    style.dataset.plugin = pluginId
    style.textContent = cssText
    document.head.append(style)
    return () => {
      style.remove()
      if (--baseUsers === 0) {
        baseStyle?.remove()
        baseStyle = undefined
      }
    }
  }, `${pluginId}: styles`)
}
