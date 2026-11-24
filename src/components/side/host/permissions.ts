import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { isSideSession } from '../shared/side-session.ts'
import type { Permission } from '../shared/protocol.ts'

// Generic program execution also supports runtimes without filesystem confinement.
const readTools = new Set(['read', 'read_image', 'glob', 'grep'])
type Policy = { parent: string; permission: Permission }

export function installPermissions(ctx: Context, lookup: (id: string) => Policy | undefined) {
  const syncing = new Set<string>()
  function parentOf(id: string) {
    const row = lookup(id)
    if (row?.permission === 'follow') return ctx.agents.get(row.parent as SessionId)?.session
  }
  function sync(session: Session) {
    if (syncing.has(session.id)) return
    syncing.add(session.id)
    try {
      const parent = parentOf(session.id)
      if (parent) {
        const preset = ctx.permissionPresets.current(parent)
        if (preset !== 'custom' && ctx.permissionPresets.current(session) !== preset)
          ctx.permissionPresets.set(session, preset)
      }
      const mode = parent
        ? (ctx.sandboxPolicy.overrideOf(parent) ?? ctx.sandboxPolicy.defaultMode)
        : 'read-only'
      const approval = parent
        ? (ctx.approval.overrideOf(parent) ?? ctx.approval.config.policy ?? 'ask')
        : 'never'
      if (ctx.sandboxPolicy.overrideOf(session) !== mode) setSandboxMode(session, mode)
      if (ctx.approval.overrideOf(session) !== approval) setApprovalPolicy(session, approval)
    } finally {
      syncing.delete(session.id)
    }
  }
  ctx.tools.guard(({ agent, name }) => {
    if (!agent || !isSideSession(agent.id)) return
    sync(agent.session)
    const parent = parentOf(agent.id)
    if (!parent && !readTools.has(name)) return '侧聊处于只读模式，无法调用 ' + name
    if (parent && name !== 'run_code' && !ctx.tools.get(name, ctx.agents.get(parent.id)))
      return '主会话当前无法使用这个工具'
  })
  function bind(agent: Agent) {
    if (!isSideSession(agent.id)) return
    sync(agent.session)
  }
  ctx.on('agent/created', ({ agent }) => {
    bind(agent)
  })
  for (const agent of ctx.agents.list()) bind(agent)
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (isSideSession(agent.id)) sync(agent.session)
    return next()
  })
  ctx.on('session/event', (session, event) => {
    if (!['sandbox/mode', 'approval/policy', 'permission/preset'].includes(event.type)) return
    if (syncing.has(session.id)) return
    // DSH disallows appending to a session from its synchronous event publisher.
    queueMicrotask(() => {
      if (ctx.fiber.uid === null) return
      if (isSideSession(session.id)) {
        if (ctx.agents.get(session.id)?.session === session) sync(session)
      } else {
        for (const agent of ctx.agents.list())
          if (parentOf(agent.id) === session) sync(agent.session)
      }
    })
  })
  return sync
}
