import type { Session } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import { isSideSession } from '../../../shared/side-session.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'rong-side-context': { kind: 'rong-side-context'; form: 'notice'; summary: string }
  }
}

/** A canceled first turn or a clean shutdown can discard the pending injection. Its original inbox record is durable. */
export function restoreLegacyContext(ctx: Context) {
  const resolved = new WeakSet<Session>()
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const result = await next()
    if (
      !isSideSession(agent.id) ||
      agent.session.header.isSeeded ||
      resolved.has(agent.session) ||
      result.kind === 'reject' ||
      !messages.length ||
      result.messages.some((m) => m.source.kind === 'rong-side-context')
    )
      return result
    let snapshot
    using cut = await ctx.sessionQuery.observeSession(agent.id, { projectionMode: 'none', signal })
    for (const event of cut.events) {
      if (event.type === 'user/message' && event.data.source.kind === 'rong-side-context') {
        resolved.add(agent.session)
        return result
      }
      if (event.type === 'agent/inbox/spliced' && !snapshot)
        snapshot = event.data.inserted.find((m) => m.source.kind === 'rong-side-context')
    }
    if (snapshot) return { ...result, messages: [snapshot, ...result.messages] }
    resolved.add(agent.session)
    return result
  })
}
