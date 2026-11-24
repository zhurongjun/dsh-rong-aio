import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionSeq, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '../../../shared/session-events.ts'

const TURN_EVENTS = new Set(['turn/start', 'user/message', 'assistant/message', 'request/header'])

function isUntouchedBlankRootSession(session: Session): boolean {
  if (session.header.origin === 'subagent') return false
  const inherited = Number(session.inheritedEventCount)
  const end = Number(session.seq)
  for (let i = 0; i < end; i++) {
    const event = session.eventAt(SessionSeq(i))
    if (!event) continue
    if (TURN_EVENTS.has(event.type)) return false
    if (i >= inherited && (event.type === 'team/mode' || event.type === 'team/task')) {
      return false
    }
  }
  return true
}

function isClaimedSession(scope: Context, id: string): boolean {
  return (
    id.startsWith('rong-side-') || Boolean(scope.bail('rong-aio/session-claim', id as SessionId))
  )
}

export function installDefaultTeam(ctx: Context): (sessionId: string) => Promise<void> {
  let ensureSessionTeam: ((sessionId: string) => Promise<void>) | undefined

  ctx.inject(['agentTeams', 'agents'], (scope) => {
    const shouldEnableDefaultTeam = (agent: Agent): boolean => {
      if (isClaimedSession(scope, agent.id)) return false
      const boundary = scope.agents.turnBoundaryOf(agent.session)
      if (boundary.lastTurn > 0 || boundary.openTurnStartSeq !== null) return false
      return isUntouchedBlankRootSession(agent.session)
    }

    for (const agent of scope.agents.list()) {
      if (shouldEnableDefaultTeam(agent)) {
        void scope.agentTeams.setEnabled(agent, true).catch(() => {})
      }
    }

    scope.on('agent/created', async ({ agent, signal }) => {
      if (shouldEnableDefaultTeam(agent)) {
        await scope.agentTeams.setEnabled(agent, true, signal)
      }
      return undefined
    })

    scope.inject(['sessionQuery', 'sessionController'], (coldScope) => {
      const pending = new Map<string, Promise<void>>()
      const settledNonBlank = new Set<string>()

      coldScope.on('rong-aio/session-removing', (id) => {
        settledNonBlank.delete(id)
      })

      ensureSessionTeam = (sessionId: string) => {
        if (
          settledNonBlank.has(sessionId) ||
          isClaimedSession(coldScope, sessionId) ||
          coldScope.agents.get(sessionId as SessionId)
        ) {
          return Promise.resolve()
        }
        const inflight = pending.get(sessionId)
        if (inflight) return inflight

        const task = (async () => {
          try {
            const blank = await coldScope.sessionQuery.inspectSession(
              sessionId as SessionId,
              (session) => Boolean(session.header.cwd) && isUntouchedBlankRootSession(session),
            )
            if (blank) {
              await coldScope.sessionController.resolveAgent(sessionId as SessionId)
            } else {
              settledNonBlank.add(sessionId)
            }
          } catch {}
        })().finally(() => {
          if (pending.get(sessionId) === task) pending.delete(sessionId)
        })
        pending.set(sessionId, task)
        return task
      }

      coldScope.effect(() => () => {
        ensureSessionTeam = undefined
        settledNonBlank.clear()
      })
    })
  })

  return (sessionId: string) => ensureSessionTeam?.(sessionId) ?? Promise.resolve()
}
