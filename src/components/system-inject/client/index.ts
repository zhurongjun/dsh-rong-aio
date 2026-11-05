/** 客户端装配入口：按会话和固定设置范围持有 store，注册输入框及原生设置插槽。 */

import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Composer } from './Composer.tsx'
import { Settings } from './Settings.tsx'
import { createInjectStore } from './store.ts'
import { SETTINGS_LABEL, SettingsNavIcon } from './SettingsNavIcon.tsx'
import css from './styles.css'

export const inject = ['slots', 'sessions', 'conversation']

/** 注册两个客户端入口并按各自身份缓存 store；样式和全部 store 随插件一起释放。 */
export function apply(ctx: Context): void {
  const settingsStores = new Map<string, ReturnType<typeof createInjectStore>>()

  /** 获取固定范围的设置 store；全局与每个工程互相隔离，防止迟到响应串范围。 */
  const settingsFor = (workspace = '') => {
    let store = settingsStores.get(workspace)
    if (!store) {
      store = createInjectStore(undefined, workspace)
      settingsStores.set(workspace, store)
    }
    return store
  }

  const stores = new Map<string, ReturnType<typeof createInjectStore>>()

  /** 按原生 session ID 复用 store；输入框重新挂载不会重复呈现已确认关闭的通知。 */
  const storeFor = (sessionId: string) => {
    let store = stores.get(sessionId)
    if (!store) {
      store = createInjectStore(sessionId)
      stores.set(sessionId, store)
    }
    return store
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-rong-aio-system-inject'
    style.textContent = css
    document.head.append(style)
    return () => {
      style.remove()
      for (const store of settingsStores.values()) store.dispose()
      settingsStores.clear()
      for (const store of stores.values()) store.dispose()
      stores.clear()
    }
  })
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: 'rong-aio-system-inject',
        order: -100,

        /** 将当前会话绑定到独立 store；外部运行时入口保持不可用，不接管其提示词。 */
        inject(sessionId) {
          return {
            store: storeFor(sessionId),
            settingsFor,
            blocks: ctx.conversation.blocks,
            available: ctx.sessions.subagentAddress(sessionId) === undefined,
          }
        },
      },
      Composer,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'rong-aio-system-inject', order: 60, label: SETTINGS_LABEL },
      () => createElement(Settings, { store: settingsFor() }),
    ),
  )
  ctx.slots.inject('settings.action', () =>
    ctx.slots.register(
      { name: 'settings.action', id: 'rong-aio-system-inject-icon' },
      SettingsNavIcon,
    ),
  )
}
