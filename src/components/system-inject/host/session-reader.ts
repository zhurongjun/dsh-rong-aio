/** 原生会话只读适配：使用公开查询与模型投影，不激活冷会话或重新装配提示词。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent'
import type { Route } from '../shared/protocol.ts'

/** 只读取已有日志；查询失败直接传播，不能把不可读的旧会话误判为空白会话。 */
export async function hasRequestHistory(ctx: Context, id: string): Promise<boolean> {
  const read = (session: Session) =>
    session
      .snapshotEvents()
      .some((event) =>
        ['turn/start', 'user/message', 'assistant/message', 'request/header'].includes(event.type),
      )
  // Host/Client 同名 Context 扩展在统一类型检查中相交；此模块只接收宿主装配的 SessionStore。
  const sessions = Reflect.get(ctx, 'sessions') as unknown as SessionStore
  const session = sessions.get(id as SessionId)
  return session ? read(session) : ctx.sessionQuery.inspectSession(id as SessionId, read)
}

/**
 * 驻留 Agent 的 model.current 是当前模型权威来源，包含尚无日志时的创建参数。
 * 冷会话只接受精确投影；迁移提示不是可授权状态，禁止用缓存或默认模型掩盖读取失败。
 */
export async function currentModel(ctx: Context, id: string): Promise<Route | undefined> {
  const agent = ctx.agents.list().find((item) => item.id === id)
  if (agent) return agent.model.current() ?? ctx.agentDefaultModel.currentSelection()
  const value = await ctx.sessionController.projections(
    { sessionId: id as SessionId },
    new AbortController().signal,
  )
  if (!value) throw new Error('原生会话不存在')
  if (value.kind !== 'sequenced') throw new Error('原生会话需要先由 DSH 完成格式迁移')
  return value.values.modelSelection?.next ?? ctx.agentDefaultModel.currentSelection()
}
