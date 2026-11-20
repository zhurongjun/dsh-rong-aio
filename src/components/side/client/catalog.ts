import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { isSideSession } from '../../../shared/side-session.ts'

/** Keep the native identity map intact for the embedded Conversation while omitting side rows from navigation. */
export function filterNavigation(ctx: Context) {
  const list = ctx.sessions.list
  const original = list.getSnapshot
  const cache = new WeakMap<SessionListState, SessionListState>()
  const visible = () => {
    const all = original.call(list)
    const previous = cache.get(all)
    if (previous) return previous
    const ids = all.ids.filter((id) => !isSideSession(id))
    const view = ids.length === all.ids.length ? all : { ...all, ids }
    cache.set(all, view)
    return view
  }
  list.getSnapshot = visible
  ctx.effect(() => () => {
    if (list.getSnapshot === visible) list.getSnapshot = original
  })
  const sessions = ctx.sessions
  const descriptor = Object.getOwnPropertyDescriptor(sessions, 'search')
  const search = sessions.search
  const searchMain: typeof search = async function (this: typeof sessions, query, signal) {
    const result = await search.call(this, query, signal)
    if (!result.ok) return result
    return {
      ...result,
      value: {
        ...result.value,
        items: result.value.items.filter((item) => !isSideSession(item.sessionId)),
      },
    }
  }
  Object.defineProperty(sessions, 'search', {
    configurable: true,
    writable: true,
    value: searchMain,
  })
  ctx.effect(() => () => {
    if (Object.getOwnPropertyDescriptor(sessions, 'search')?.value !== searchMain) return
    if (descriptor) Object.defineProperty(sessions, 'search', descriptor)
    else Reflect.deleteProperty(sessions, 'search')
  })
}
