/** 宿主请求护栏、选模前置拦截与原生会话只读投影适配。 */

import { symbols, type Context } from '@deepseek-ai/cordis'
import type { SessionSelectModelRequest } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { INJECT_SELECTION_ERROR, type Route } from '../shared/protocol.ts'
import type { Controller } from './controller.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'rong-aio/inject-selection-rejected': { sessionId: string; noticeId: number }
  }
}

/** 明确拒绝表示没有提交选择，区别于结果未知的通信/写入错误。 */
export function selectionError(sessionId: string, noticeId: number, message: string) {
  return new RemoteError(INJECT_SELECTION_ERROR, message, { sessionId, noticeId })
}

/** 只读取已有日志；查询失败直接传播，不能把不可读的旧会话误判为空白会话。 */
export async function hasRequestHistory(ctx: Context, id: string): Promise<boolean> {
  const read = (session: Session) =>
    session
      .snapshotEvents()
      .some((event) =>
        ['turn/start', 'user/message', 'assistant/message', 'request/header'].includes(event.type),
      )
  const sessions = ctx.sessions
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

/** 0.2.2-rc.3 无选模前置事件。仅装饰公开方法，保留 Remote/调用作用域及原方法的所有副作用。 */
export function installSelectionGuard(
  ctx: Context,
  controller: Controller,
  initialize: (id: string) => Promise<unknown>,
): void {
  const service = ctx.sessionController
  const target = Reflect.get(service, symbols.original) ?? service

  // 保存原有属性描述符；停用时既能恢复实例方法，也能还原继承的方法查找。
  const descriptor = Object.getOwnPropertyDescriptor(target, 'selectModel')
  const original: typeof service.selectModel = target.selectModel
  if (typeof original !== 'function') throw new Error('当前 DSH 不支持选模前置校验')
  let active = true

  // 保留调用者 this，先确保会话已恢复，再进入与选词共用的串行校验队列。
  const guarded = async function (this: typeof service, request: SessionSelectModelRequest) {
    if (!active) return original.call(this, request)
    await initialize(request.sessionId)
    return controller.selectModel(request.sessionId, request, () => original.call(this, request))
  }

  Object.defineProperty(target, 'selectModel', {
    configurable: true,
    writable: true,
    value: guarded,
  })
  ctx.effect(() => () => {
    active = false

    // 其他插件若在我们之后装饰此方法，不覆盖其引用；它保留的本层引用将直接放行。
    if (target.selectModel !== guarded) return
    if (descriptor) Object.defineProperty(target, 'selectModel', descriptor)
    else delete target.selectModel
  })
}

function systemText(options: GenerateOptions): string {
  if (options.system !== undefined) return options.system
  const first = options.messages[0]
  return first?.role === 'system'
    ? first.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    : ''
}

/** 唯一实际路由护栏。预览、选模和 agent/request 的初始配置都不在这里冒充实际请求。 */
export async function guardRequest(
  controller: Controller,
  options: GenerateOptions,
): Promise<void> {
  const id = options.sessionId
  if (!id || !controller.sessions.entries.has(id)) return
  try {
    const body = controller.body(id)
    const text = systemText(options)

    // 标题仅在完全不携带注入正文时独立运行；压缩等辅助请求仍经过同一护栏。
    if (
      options.purpose === 'session-title' &&
      (!body ||
        (!text.includes(body) &&
          !options.messages.some((item) =>
            item.content.some((part) => part.type === 'text' && part.text.includes(body)),
          )))
    )
      return
    await controller.admit(id, options, text)
  } catch (error) {
    throw controller.fail(id, error)
  }
}
