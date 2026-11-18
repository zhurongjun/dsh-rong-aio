/** 用公开的 DSH 路由和流事件调用速度插件，存储与提供商由测试宿主提供。 */
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareBundle } from '../../integration/helpers/bundle.mjs'

export async function speedHost(t) {
  const ctx = new Context()
  const records = new Map()
  const protocols = { openai: 'openai-responses', anthropic: 'anthropic-messages' }
  let diskFailure = false
  ctx.provide('storageDomain', {
    open: async () => ({
      table: () => ({
        get: (key) => records.get(key),
        put: async (key, value) => {
          if (diskFailure) throw new Error('disk failure')
          records.set(key, value)
        },
      }),
      close() {},
    }),
  })
  ctx.provide('llm', {
    resolveModelInfo: async (_provider, model) => ({
      name: model === 'catalog-alias' ? 'GPT 6 Astra' : model,
    }),
    listConfigurableProviders: () =>
      Object.keys(protocols).map((provider) => ({
        provider,
        settingsNs: provider,
        settingsPath: [],
      })),
  })
  ctx.provide('settings', {
    describe: () => Object.entries(protocols).map(([ns, api]) => ({ ns, value: { api } })),
  })
  new HostConnectionService(ctx, [], {})
  await mkdir('agent_temp/tests', { recursive: true })
  const root = await mkdtemp(resolve('agent_temp/tests/speed-'))
  t.after(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  const components = await prepareBundle(ctx, root)
  await ctx.loader.root.update(
    components.filter((entry) => entry.name === 'dsh-rong-aio/model-selector'),
  )
  await ctx.loader.await()
  const http = ctx.connection.createSharedFetchHandler('/api')
  const call = (identity, mode) => {
    const url = 'http://fixture/api/rong-aio.speed'
    const request =
      mode === undefined
        ? new Request(url + '?' + new URLSearchParams(identity))
        : new Request(url, { method: 'POST', body: JSON.stringify({ ...identity, mode }) })
    return http.fetch(request, ctx.connection.browserPeer)
  }
  return {
    ctx,
    call,
    protocols,
    failWrites() {
      diskFailure = true
    },
  }
}
