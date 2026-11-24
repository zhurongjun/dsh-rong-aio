import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { isSideSession, type Permission } from '../shared/protocol.ts'

const readTools = new Set(['read', 'read_image', 'glob', 'grep'])
const offLimitsTools = new Set([
  'subagent',
  'subagent_fork',
  'list_agents',
  'wait_agent',
  'send_message',
  'interrupt_agent',
  'list_subagent_models',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
])

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

    if (offLimitsTools.has(name)) return '侧聊不支持调用子代理或团队协作工具：' + name
    const parent = parentOf(agent.id)
    if (!parent && !readTools.has(name)) return '侧聊处于只读模式，无法调用 ' + name
    if (parent && name !== 'run_code' && !ctx.tools.get(name, ctx.agents.get(parent.id)))
      return '主会话当前无法使用这个工具'
  })

  for (const agent of ctx.agents.list()) {
    if (isSideSession(agent.id)) sync(agent.session)
  }

  ctx.on('agent/created', ({ agent }) => {
    if (isSideSession(agent.id)) sync(agent.session)
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (isSideSession(agent.id)) sync(agent.session)
    return next()
  })

  ctx.on('session/event', (session, event) => {
    if (!['sandbox/mode', 'approval/policy', 'permission/preset'].includes(event.type)) return
    if (syncing.has(session.id)) return

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
