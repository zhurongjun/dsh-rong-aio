import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-commands'
import {
  buildForkSeed,
  SessionLogOffset,
  type SessionId,
  type SessionStore,
} from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type { Permission } from '../shared/protocol.ts'

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
    const last = events.at(-1)
    const seed = last ? buildForkSeed(events, last.seq) : []
    const fallback = parent.model.current() ?? ctx.agentDefaultModel.currentSelection()
    const presets = parent.ctx.get('agentPresets')
    const agentPreset = presets?.composedPreset(parent.ctx)
    const handle = await ctx.agents.create({
      sessionId: id,
      seed,
      inheritedEventCount: SessionLogOffset(events.length),
      agentOptions: fallback,
      meta: {
        cwd: parent.session.header.cwd,
        agentPreset,
        isSeeded: true,
        ...(seed.some((e) => e.type === 'request/header') && { parentSession: parent.id }),
      },
      setup(scoped, agent) {
        // Pending input at the parent's cut belongs exclusively to its own driver.
        agent.inbox.clear()
        configure(scoped)
        presets?.composeFrom(scoped, parent.ctx)
        agent.model.select(agent.session.requestHeader()?.config ?? fallback)
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
