/** 模型选择器宿主入口：注册速度设置接口、profile 存储及实际请求的速度适配。 */

import type {} from '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-settings'
import * as z from 'zod'
import {
  HttpError,
  jsonResponse,
  parseQueryParams,
  registerJsonEndpoint,
} from '../../../host/http.ts'
import { speedKey, speedRuleFor, type SpeedMode, type SpeedRule } from '../shared/speed.ts'
import { createSpeedTransport } from './speed-transport.ts'
import type {} from '../../../shared/session-events.ts'

export const inject = ['llm', 'storageDomain', 'connection', 'settings']

const identitySchema = z.object({
  sessionId: z.string().min(1).max(512),
  provider: z.string().min(1).max(512),
  model: z.string().min(1).max(512),
})

const modeSchema = z.enum(['standard', 'fast', 'ultrafast'])
const speedCommandSchema = identitySchema.extend({ mode: modeSchema })

// 公开 domain 声明格式；schema 和存储版本一起维护，不依赖后端文件路径。
const spec = {
  name: 'rong_aio_speed',
  version: 1,
  tables: { selections: { valueSchema: modeSchema } },
}

/** 只接管已验证的 HTTP 协议；Codex OAuth、Bedrock 等协议不冒充可用。 */
function modesForRoute(ctx: Context, provider: string, rule: SpeedRule): readonly SpeedMode[] {
  const entry = ctx.llm.listConfigurableProviders().find((item) => item.provider === provider)
  if (!entry) return []
  let profile: unknown = ctx.settings
    .describe({ redactSecrets: true })
    .find((item) => item.ns === entry.settingsNs)?.value
  for (const segment of entry.settingsPath) {
    profile = profile && typeof profile === 'object' ? Reflect.get(profile, segment) : undefined
  }
  const configured =
    profile && typeof profile === 'object' ? Reflect.get(profile, 'api') : undefined
  const api =
    configured ??
    (provider === 'openai'
      ? 'openai-responses'
      : provider === 'anthropic'
        ? 'anthropic-messages'
        : undefined)
  if (rule.family === 'anthropic') return api === 'anthropic-messages' ? rule.modes : []
  if (api === 'openai-responses') return rule.modes

  // 官方 Ultrafast 只明确提供 Responses 用法，Completions 暂仅开放标准/快速。
  return api === 'openai-completions' ? rule.modes.filter((mode) => mode !== 'ultrafast') : []
}

/**
 * 打开 profile 速度域并注册接口/流式钩子；所有资源随 Cordis effect 释放。
 * 保存接口只有写盘成功才返回新状态，流式请求在真正执行时重新核对能力。
 */
export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(spec)
  ctx.effect(() => () => domain.close())
  const table = domain.table('selections')
  ctx.on('rong-aio/session-removing', async (id) => {
    const prefix = '[' + JSON.stringify(id) + ','
    for (const key of table.keys()) {
      if (key.startsWith(prefix)) await table.delete(key)
    }
  })
  const transport = createSpeedTransport()
  ctx.effect(() => () => transport.dispose())

  registerJsonEndpoint(ctx, {
    path: '/api/rong-aio.speed',
    errorStatus: 503,
    formatError: () => ({ message: '无法读取或保存速度设置，请重试' }),
    async fetch(request) {
      let identity: z.infer<typeof identitySchema>
      let requested: SpeedMode | undefined
      if (request.method === 'GET') {
        identity = parseQueryParams(request, identitySchema, '无效的会话或模型标识')
      } else {
        const raw: unknown = await request.json().catch(() => undefined)
        const idParsed = identitySchema.safeParse(raw)
        if (!idParsed.success) throw new HttpError(400, '无效的会话或模型标识')
        identity = idParsed.data
        const cmdParsed = speedCommandSchema.safeParse(raw)
        if (!cmdParsed.success) throw new HttpError(400, '当前模型不支持此速度档位')
        requested = cmdParsed.data.mode
      }

      const model = await ctx.llm.resolveModelInfo(identity.provider, identity.model)
      const rule = speedRuleFor(identity.model, model?.name)
      const modes = rule ? modesForRoute(ctx, identity.provider, rule) : []
      const supported = modes.length > 1
      const key = speedKey(identity)

      // 写入前同时核验档位语法和实际协议能力，不能让客户端自报支持。
      if (requested !== undefined) {
        if (!modes.includes(requested)) {
          throw new HttpError(400, '当前模型不支持此速度档位')
        }
        await table.put(key, requested)
      }
      const saved = table.get(key) ?? 'standard'
      return jsonResponse({
        mode: modes.includes(saved) ? saved : 'standard',
        modes,
        ...(!supported
          ? { reason: rule ? '当前连接协议暂不支持速度参数' : '此模型不在支持规则内' }
          : {}),
      })
    },
  })

  // 普通会话生成才继承 Fast；标题、压缩等辅助用途保持原生速度行为。
  ctx.on('llm/stream', (options, next) => {
    if (!options.sessionId || options.purpose) return next()
    const key = speedKey({
      sessionId: options.sessionId,
      provider: options.provider,
      model: options.model,
    })
    return (async function* () {
      const model = await ctx.llm.resolveModelInfo(options.provider, options.model)
      const rule = speedRuleFor(options.model, model?.name)
      if (!rule) return yield* next()
      const modes = modesForRoute(ctx, options.provider, rule)
      if (!modes.length) return yield* next()
      const saved = table.get(key) ?? 'standard'
      const mode: SpeedMode = modes.includes(saved) ? saved : 'standard'
      yield* transport.stream({ model: options.model, rule, mode }, next)
    })()
  })
}
