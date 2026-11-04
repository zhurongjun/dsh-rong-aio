import { symbols, type Context } from '@deepseek-ai/cordis'
import type { SessionSelectModelRequest } from '@deepseek-ai/dsh-api-session-controller'
import type { Controller } from './controller.ts'

/** rc.5 无选模前置事件。仅装饰公开方法，保留 Remote/调用作用域及原方法的所有副作用。 */
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
    // 其他插件若在我们之后装饰此方法，不覆盖其引用；它保留的本层引用将直接放行。
    if (target.selectModel !== guarded) return
    if (descriptor) Object.defineProperty(target, 'selectModel', descriptor)
    else delete target.selectModel
  })
}
