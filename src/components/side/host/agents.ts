import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-commands'
import {
  buildForkSeed,
  SessionLogOffset,
  type SessionEvent,
  type SessionId,
  type SessionStore,
} from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type { Permission } from '../shared/protocol.ts'

const TRAILING_UNCOMMITTED = new Set([
  'model/selection',
  'team/mode',
  'plan/mode',
  'command/run',
  'command/done',
  'agent/inbox/spliced',
])

function lastRequestHeaderSeq(events: readonly SessionEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'request/header') return events[i].seq
  }
  return undefined
}

function forkBoundary(events: readonly SessionEvent[], lastHeaderSeq: number | undefined) {
  if (!events.length) return undefined
  let index = events.length - 1
  if (lastHeaderSeq !== undefined) {
    while (index > lastHeaderSeq && TRAILING_UNCOMMITTED.has(events[index].type)) index--
  }
  return events[index]?.seq
}

function teamEnabledAtHeader(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
  lastHeaderSeq: number,
): boolean {
  let enabled: boolean | undefined
  for (const event of events) {
    if (event.seq < inheritedEventCount) continue
    if (event.seq > lastHeaderSeq) break
    if (event.type === 'team/mode') enabled = event.data.enabled
    else if (event.type === 'team/task') enabled ??= true
  }
  return enabled === true
}

/** Owns only the DSH agent handles created or resumed by the side plugin. */
export function sideAgents(ctx: Context, permissionOf: (id: string) => Permission | undefined) {
  const handles = new Map<SessionId, AgentHandle>()
  function configure(scoped: Context) {
    installModelSelection(scoped)
    scoped.inject(['commands'], (bound) => {
      bound.commands.register({
        name: 'permission',
        description: '查看侧聊权限',
        input: { hint: '权限' },
        handler: ({ rawInput, agent }) =>
          rawInput.trim()
            ? { kind: 'error', text: '请在这条侧聊的输入框中修改权限。' }
            : {
                kind: 'success',
                text: permissionOf(agent.id) === 'follow' ? '跟随主会话' : '只读',
              },
      })
    })
  }

  async function fork(parent: Agent, id: SessionId, cut: SessionObservation) {
    if (parent.session.header.createdAt !== cut.header.createdAt)
      throw new Error('主会话已更换，请重新打开侧聊')
    const events = cut.events
    const lastHeaderSeq = lastRequestHeaderSeq(events)
    const boundary = forkBoundary(events, lastHeaderSeq)
    const seed = boundary !== undefined ? buildForkSeed(events, boundary) : []
    const inheritedEventCount = SessionLogOffset(boundary !== undefined ? boundary + 1 : 0)
    const teamEnabled =
      lastHeaderSeq !== undefined
        ? teamEnabledAtHeader(events, cut.inheritedEventCount, lastHeaderSeq)
        : undefined
    const fallback = parent.model.current() ?? ctx.agentDefaultModel.currentSelection()
    const presets = parent.ctx.get('agentPresets')
    const agentPreset = presets?.composedPreset(parent.ctx)
    const handle = await ctx.agents.create({
      sessionId: id,
      seed,
      inheritedEventCount,
      agentOptions: fallback,
      meta: {
        cwd: parent.session.header.cwd,
        agentPreset,
        isSeeded: true,
        ...(lastHeaderSeq !== undefined && { parentSession: parent.id }),
      },
      setup(scoped, agent) {
        // Pending input at the parent's cut belongs exclusively to its own driver.
        agent.inbox.clear()
        configure(scoped)
        presets?.composeFrom(scoped, parent.ctx)
        agent.model.select(agent.session.requestHeader()?.config ?? fallback)
        if (teamEnabled !== undefined) agent.session.append('team/mode', { enabled: teamEnabled })
      },
    })
    handles.set(id, handle)
    return handle.agent
  }
  async function open(id: SessionId) {
    const active = ctx.agents.get(id)
    if (active) return active
    const stat = await ctx.sessionPersistence.stat(id)
    if (!stat) throw new Error('找不到侧聊日志')
    const handle = await ctx.agents.resume({
      resumeSessionId: id,
      setup: async (scoped) => {
        configure(scoped)
        if (stat.header.agentPreset) {
          const presets = ctx.get('agentPresets')
          if (!presets) throw new Error('恢复侧聊需要原会话的 Agent 预设服务')
          await presets.mount(scoped, stat.header.agentPreset)
        }
      },
    })
    handles.set(id, handle)
    return handle.agent
  }
  async function release(id: SessionId, flushTo?: SessionStore) {
    const handle = handles.get(id)
    if (!handle) {
      if (ctx.agents.get(id)) throw new Error('侧聊正被其他操作占用')
      return
    }
    if (flushTo) await flushTo.flush(handle.agent.session)
    await handle.dispose()
    handles.delete(id)
  }
  return {
    fork,
    open,
    release,
    dispose: () => Promise.all([...handles.keys()].map((id) => release(id))),
  }
}
