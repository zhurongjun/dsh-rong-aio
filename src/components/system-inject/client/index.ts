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
    const idle: [string, InjectStore][] = []
    for (const entry of pool) {
      if (!entry[1].isRetained()) idle.push(entry)
    }

    const overflow = idle.length - maxIdle
    for (let i = 0; i < overflow; i++) {
      const [key, store] = idle[i]
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

  ctx.slots.inject('settings.section.icon', () =>
    ctx.slots.register({ name: 'settings.section.icon', id: SETTINGS_ID }, ({ size }) =>
      createElement(ArmorIcon, { active: true, size }),
    ),
  )
}
