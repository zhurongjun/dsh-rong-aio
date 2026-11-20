/** 宿主装配入口：连接原生会话、提示词、模型与 HTTP 服务，不在入口实现文件事务。 */

import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionStore as NativeSessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { API, commandSchema, type StateView } from '../shared/protocol.ts'
import { Controller } from './controller.ts'
import { Paths } from './paths.ts'
import { SessionStore, type SessionMeta, type SessionEntry } from './session-store.ts'
import { sessionDirectory, sessionRoot } from '../../../host/session-location.ts'
import { guardRequest } from './request-guard.ts'
import { installSelectionGuard } from './model-selection.ts'
import { currentModel, hasRequestHistory } from './session-reader.ts'
import { isInjectSelectionError } from '../shared/selection-error.ts'

export const inject = [
  'agents',
  'sessions',
  'systemPrompt',
  'llm',
  'connection',
  'loader',
  'sessionPersistence',
  'sessionController',
  'workspaceRegistry',
  'agentDefaultModel',
  'sessionQuery',
]

const SECTION = 'rong-aio:system-inject'

/** 入口仅装配依赖和公开钩子；磁盘、解析及请求事务由各职责模块维护。 */
export async function apply(ctx: Context): Promise<void> {
  if (!ctx.dshHomePath) throw new Error('DSH 未提供用户目录解析服务')
  const paths = new Paths(ctx.dshHomePath('system_inject'))
  const nativeSessions = Reflect.get(ctx, 'sessions') as unknown as NativeSessionStore
  const persistence = ctx.sessionPersistence

  // 会话存储适配：目录定位、原生日志落盘与请求历史判定分别注入。
  const sessions = new SessionStore(
    (meta) => sessionDirectory(sessionRoot(ctx), meta),
    async (id) => {
      const session = nativeSessions.get(id as Agent['id'])
      if (!session) {
        if (!(await persistence.stat(id as Agent['id']))) throw new Error('原生会话不存在')
        return
      }
      if (!(await nativeSessions.flush(session))) throw new Error('无法持久化原生会话日志')
    },
    ({ id }) => hasRequestHistory(ctx, id),
  )

  const controller = new Controller(paths, sessions, (id) => currentModel(ctx, id))
  ctx.on('rong-aio/session-removing', (id) => {
    sessions.entries.delete(id)
  })
  ctx.effect(() => () => controller.close())

  /**
   * 按需恢复本地会话，优先自身快照，首次继承时才递归解析父状态。
   * seen 检测继承循环；定位或恢复失败限制在该会话，不拖垮整个插件。
   */
  const initialize = async (id: string, seen = new Set<string>()): Promise<SessionEntry> => {
    if (sessions.entries.has(id)) return sessions.get(id)
    if (seen.has(id)) throw new Error('会话继承关系存在循环')
    seen.add(id)
    try {
      const agent = ctx.agents.list().find((item) => item.id === id)
      const header = agent?.session.header ?? (await persistence.stat(id as Agent['id']))?.header
      if (!header) throw new Error('无法定位原生会话')
      const parent = header.parentSession
      const meta: SessionMeta = { id, cwd: header.cwd, parent }
      const entry = await sessions.initialize(
        meta,
        parent ? () => initialize(parent, new Set(seen)) : undefined,
      )
      return entry
    } catch (error) {
      return sessions.unavailable(id, error)
    }
  }

  // 原生生命周期：创建时初始化，空闲/释放时清除请求候选和 busy。
  ctx.on('agent/created', async ({ agent }) => {
    await initialize(agent.id)
  })
  for (const agent of ctx.agents.list()) await initialize(agent.id)
  installSelectionGuard(ctx, controller, initialize)
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') sessions.idle(agent.id)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    sessions.idle(agent.id)
  })

  // 系统首段：注册字面段落；真正装配时捕获候选，绝不从 UI 预览触发。
  ctx.systemPrompt.section({
    name: SECTION,
    order: ctx.systemPrompt.getSectionOrder('HARNESS_IDENTITY') - 1,
    interpolate: false,
    text: '',
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    if (context.agent) {
      try {
        await initialize(context.agent.id)
        await controller.capture(context.agent.id)
      } catch (error) {
        throw controller.fail(context.agent.id, error)
      }
    }
    const result = await next()
    const section = result.sections.find((item) => item.name === SECTION)
    if (section) {
      section.text = context.agent ? controller.body(context.agent.id) : ''
      result.sections = [section, ...result.sections.filter((item) => item !== section)]
    }
    return result
  })

  // 最终分发边界：等待其他钩子确定路由后才执行护栏，之后才能调用适配器。
  ctx.on('llm/stream', (options, next) =>
    (async function* () {
      if (options.sessionId && ctx.agents.list().some((agent) => agent.id === options.sessionId))
        await initialize(options.sessionId)
      await guardRequest(controller, options)
      yield* next()
    })(),
  )

  // HTTP 入口：校验范围与命令，返回文件或会话投影；通知错误保留可识别协议。
  const connection = Reflect.get(ctx, 'connection') as unknown as HostConnectionHandle
  connection.fetch.register({
    path: API,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',

    /** 校验会话/工程范围，执行可选命令，再返回同一范围的权威视图；异常返回 409。 */
    async fetch(request) {
      try {
        const url = new URL(request.url)
        const id = url.searchParams.get('sessionId') || undefined
        if (id) await initialize(id)
        const workspace = id
          ? (sessions.get(id).meta.cwd ?? '')
          : (url.searchParams.get('workspace') ?? '')
        if (
          workspace &&
          !ctx.workspaceRegistry.list().some((item) => item.path === workspace) &&
          ![...sessions.entries.values()].some((entry) => entry.meta.cwd === workspace)
        )
          throw new Error('工作区未在 DSH 中注册')
        if (request.method === 'POST') {
          const parsed = commandSchema.safeParse(await request.json())
          if (!parsed.success)
            return Response.json(
              { error: '设置格式无效，请检查名称、正文和精确模型标识' },
              { status: 400 },
            )
          if ('sessionId' in parsed.data) await initialize(parsed.data.sessionId)
          await controller.command(parsed.data, workspace)
        }
        const view = await controller.view(id, workspace)
        const catalogErrors: string[] = []
        const routes = id
          ? []
          : (
              await Promise.all(
                ctx.llm.listProviders().map(async (provider) => {
                  try {
                    return (await ctx.llm.listModels(provider.id)).map((model) => ({
                      provider: provider.id,
                      model: model.id,
                      providerName: provider.name || provider.id,
                      modelName: model.name || model.id,
                    }))
                  } catch {
                    catalogErrors.push(`${provider.id} 的模型目录暂时无法读取`)
                    return []
                  }
                }),
              )
            ).flat()
        const data: StateView = {
          ...view,
          references: id ? {} : controller.references(),
          routes,
          catalogErrors,
        }
        return Response.json(data, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : '无法读取或保存破甲设置',
            ...(isInjectSelectionError(error)
              ? {
                  code: (error as { code: string }).code,
                  details: (error as { details: unknown }).details,
                }
              : {}),
          },
          { status: 409 },
        )
      }
    },
  })
}
