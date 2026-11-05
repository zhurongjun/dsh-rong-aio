/** HTTP 速度参数适配：使用异步请求作用域隔离并发调用，不改写消息正文。 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { SpeedMode, SpeedRule } from '../shared/speed.ts'

/** 一个流式调用的速度上下文，通过 AsyncLocalStorage 与其他并发请求隔离。 */
interface SpeedCall {
  /** 本次实际请求的模型 ID，只改写 body.model 完全相等的请求。 */
  model: string

  /** 宿主已经核验型号和连接协议的规则。 */
  rule: SpeedRule

  /** 本次请求捕获的速度档位，不随后续 UI 修改变化。 */
  mode: SpeedMode
}

/** rc.5 没有 payload 扩展口；只在 llm/stream 的异步作用域内处理 HTTP JSON。 */
export function createSpeedTransport() {
  const scope = new AsyncLocalStorage<SpeedCall>()
  const original = globalThis.fetch
  let active = true

  // 无本组件作用域、协议不匹配、非 JSON 或模型不相等的调用一律透传。
  const wrapped: typeof fetch = async (input, init) => {
    const call = active ? scope.getStore() : undefined
    if (!call) return original(input, init)
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = url.pathname.replace(/\/$/, '')
    const matches =
      call.rule.family === 'openai'
        ? /\/(?:responses|chat\/completions)$/.test(path)
        : path.endsWith('/messages')
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (!matches || method.toUpperCase() !== 'POST') return original(input, init)
    const request = new Request(input, init)
    const payload: unknown = await request
      .clone()
      .json()
      .catch(() => null)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return original(request)
    const body = payload as Record<string, unknown>

    // 只处理当前模型，不改写同一异步链上的发现、遥测或其他模型请求。
    if (body.model !== call.model) return original(request)
    const headers = new Headers(request.headers)
    if (call.rule.family === 'openai') {
      body.service_tier = call.mode === 'standard' ? 'default' : call.mode

      // 可选 header 必须与 body 一致；移除配置中可能残留的旧档位，由 body 明确指定。
      headers.delete('openai-service-tier')
    } else {
      body.speed = call.mode
      if (call.mode === 'fast' && call.rule.beta) {
        const values = new Set(
          (headers.get('anthropic-beta') ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        )
        values.add(call.rule.beta)
        headers.set('anthropic-beta', [...values].join(','))
      }
    }

    // 请求体重序列化后交给 fetch 重新计算长度，同时保留原取消信号和其他请求属性。
    headers.delete('content-length')
    return original(new Request(request, { method: 'POST', headers, body: JSON.stringify(body) }))
  }

  globalThis.fetch = wrapped
  return {
    /** 包装异步迭代器的整个消费过程；next/return/throw 都在同一速度作用域执行。 */
    stream<T>(call: SpeedCall, next: () => AsyncIterable<T>): AsyncIterable<T> {
      return {
        [Symbol.asyncIterator]() {
          const iterator = scope.run(call, () => next()[Symbol.asyncIterator]())
          return {
            next: () => scope.run(call, () => iterator.next()),
            return: async () =>
              scope.run(
                call,
                () =>
                  iterator.return?.() ?? Promise.resolve({ done: true as const, value: undefined }),
              ),
            throw: async (error: unknown) =>
              scope.run(call, () => {
                if (iterator.throw) return iterator.throw(error)
                throw error
              }),
          }
        },
      }
    },

    /** 使残留包装引用退化为原始 fetch，并仅在自己仍拥有全局引用时还原。 */
    dispose() {
      active = false
      if (globalThis.fetch === wrapped) globalThis.fetch = original
      scope.disable()
    },
  }
}
