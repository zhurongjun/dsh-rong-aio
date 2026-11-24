import { AsyncLocalStorage } from 'node:async_hooks'
import type { SpeedMode, SpeedRule } from '../shared/speed.ts'

interface SpeedCall {
  model: string
  rule: SpeedRule
  mode: SpeedMode
}

export function createSpeedTransport() {
  const scope = new AsyncLocalStorage<SpeedCall>()
  const original = globalThis.fetch
  let active = true

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
    if (body.model !== call.model) return original(request)

    const headers = new Headers(request.headers)
    if (call.rule.family === 'openai') {
      body.service_tier = call.mode === 'standard' ? 'default' : call.mode
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

    headers.delete('content-length')
    return original(new Request(request, { method: 'POST', headers, body: JSON.stringify(body) }))
  }

  globalThis.fetch = wrapped

  return {
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

    dispose() {
      active = false
      if (globalThis.fetch === wrapped) globalThis.fetch = original
      scope.disable()
    },
  }
}
