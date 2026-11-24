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

export function selectionError(sessionId: string, noticeId: number, message: string) {
  return new RemoteError(INJECT_SELECTION_ERROR, message, { sessionId, noticeId })
}

export async function hasRequestHistory(ctx: Context, id: string): Promise<boolean> {
  const read = (session: Session) =>
    session
      .snapshotEvents()
      .some((event) =>
        ['turn/start', 'user/message', 'assistant/message', 'request/header'].includes(event.type),
      )

  const session = ctx.sessions.get(id as SessionId)
  return session ? read(session) : ctx.sessionQuery.inspectSession(id as SessionId, read)
}

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

export function installSelectionGuard(
  ctx: Context,
  controller: Controller,
  initialize: (id: string) => Promise<unknown>,
): void {
  const service = ctx.sessionController
  const target = Reflect.get(service, symbols.original) ?? service
  const descriptor = Object.getOwnPropertyDescriptor(target, 'selectModel')
  const original: typeof service.selectModel = target.selectModel
  if (typeof original !== 'function') throw new Error('当前 DSH 不支持选模前置校验')

  let active = true
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

export async function guardRequest(
  controller: Controller,
  options: GenerateOptions,
): Promise<void> {
  const id = options.sessionId
  if (!id || !controller.sessions.entries.has(id)) return

  try {
    const body = controller.body(id)
    const text = systemText(options)

    if (
      options.purpose === 'session-title' &&
      (!body ||
        (!text.includes(body) &&
          !options.messages.some((item) =>
            item.content.some((part) => part.type === 'text' && part.text.includes(body)),
          )))
    ) {
      return
    }

    await controller.admit(id, options, text)
  } catch (error) {
    throw controller.fail(id, error)
  }
}
