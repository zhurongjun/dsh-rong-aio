/** 客户端装配入口：按会话和固定设置范围持有有限缓存 store，注册输入框及原生设置插槽。 */

import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { mountStyle } from '../../../client/style.ts'
import { ArmorIcon } from './ArmorIcon.tsx'
import { Composer } from './Composer.tsx'
import { Settings } from './Settings.tsx'
import { createInjectStore, type InjectStore } from './store.ts'
import css from './styles.css'

const SETTINGS_ID = 'rong-aio-system-inject'
const MAX_IDLE_SESSION_STORES = 32
const MAX_IDLE_SETTINGS_STORES = 8

export const inject = ['slots', 'sessions', 'conversation']

function createBoundedStorePool(
  maxIdle: number,
  factory: (key: string, onRelease: () => void) => InjectStore,
) {
  const pool = new Map<string, InjectStore>()

  function trimIdle() {
    const idleKeys: string[] = []
    for (const [key, store] of pool) {
      if (!store.isRetained()) idleKeys.push(key)
    }
    const overflow = idleKeys.length - maxIdle
    for (let i = 0; i < overflow; i++) {
      const key = idleKeys[i]
      const store = pool.get(key)
      if (!store) continue
      store.dispose()
      pool.delete(key)
    }
  }

  return {
    get(key: string): InjectStore {
      const existing = pool.get(key)
      if (existing) {
        pool.delete(key)
        pool.set(key, existing)
        return existing
      }
      const created = factory(key, trimIdle)
      pool.set(key, created)
      trimIdle()
      return created
    },
    disposeAll() {
      for (const store of pool.values()) store.dispose()
      pool.clear()
    },
  }
}

/** 注册两个客户端入口并按各自身份缓存 store；样式和全部 store 随插件一起释放。 */
export function apply(ctx: Context): void {
  const settingsPool = createBoundedStorePool(MAX_IDLE_SETTINGS_STORES, (workspace, onRelease) =>
    createInjectStore(undefined, workspace, onRelease),
  )
  const sessionPool = createBoundedStorePool(MAX_IDLE_SESSION_STORES, (sessionId, onRelease) =>
    createInjectStore(sessionId, '', onRelease, (reason) =>
      ctx.conversation.blocks.set(sessionId as SessionId, reason ? { reason } : undefined),
    ),
  )

  const settingsFor = (workspace = '') => settingsPool.get(workspace)

  mountStyle(ctx, 'dsh-rong-aio-system-inject', css)
  ctx.effect(() => () => {
    settingsPool.disposeAll()
    sessionPool.disposeAll()
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
            store: sessionPool.get(sessionId),
            settingsFor,
            available: ctx.sessions.subagentAddress(sessionId) === undefined,
          }
        },
      },
      Composer,
    ),
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: SETTINGS_ID, order: 60, label: '破甲模式' },
      () => createElement(Settings, { store: settingsFor() }),
    ),
  )

  // 原生设置外壳按分类 ID 渲染图标，尺寸与生命周期均由宿主管理。
  ctx.slots.inject('settings.section.icon', () =>
    ctx.slots.register({ name: 'settings.section.icon', id: SETTINGS_ID }, ({ size }) =>
      createElement(ArmorIcon, { active: true, size }),
    ),
  )
}
