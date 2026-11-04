import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionLogOffset, type SessionStore as NativeSessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-projection'
import { API, commandSchema, type StateView } from '../shared/protocol.ts'
import { Controller } from './controller.ts'
import { Paths } from './paths.ts'
import { SessionStore, type SessionMeta, type SessionEntry } from './session-store.ts'
import { sessionDirectory, sessionRoot } from './session-location.ts'
import { guardRequest } from './request-guard.ts'
import { installSelectionGuard } from './model-selection.ts'
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
  'sessionProjections',
]
const SECTION = 'rong-aio:system-inject'
interface Connection {
  fetch: {
    register(route: {
      path: string
      methods: string[]
      requestBody: 'buffered'
      fetch(request: Request): Promise<Response>
    }): void
  }
}
interface Persistence {
  stat(
    id: string,
  ): Promise<{ header: { id: string; cwd?: string; parentSession?: string } } | undefined>
}

/** 入口仅装配依赖和公开钩子；磁盘、解析及请求事务由各职责模块维护。 */
export async function apply(ctx: Context): Promise<void> {
  if (!ctx.dshHomePath) throw new Error('DSH 未提供用户目录解析服务')
  const paths = new Paths(ctx.dshHomePath('system_inject'))
  const nativeSessions = Reflect.get(ctx, 'sessions') as unknown as NativeSessionStore
  const persistence = Reflect.get(ctx, 'sessionPersistence') as Persistence
  const sessions = new SessionStore(
    (meta) => sessionDirectory(sessionRoot(ctx), meta),
    async (id) => {
      const session = nativeSessions.get(id as Agent['id'])
      if (!session) {
        if (!(await persistence.stat(id))) throw new Error('原生会话不存在')
        return
      }
      if (!(await nativeSessions.flush(session))) throw new Error('无法持久化原生会话日志')
    },
    async ({ id }) => {
      const session = nativeSessions.get(id as Agent['id'])
      const events =
        session?.snapshotEvents() ?? (await ctx.sessionController.inspect(id as Agent['id'])).events
      return events.some((event) =>
        ['turn/start', 'user/message', 'assistant/message', 'request/header'].includes(event.type),
      )
    },
  )
  const controller = new Controller(paths, sessions, async (id) => {
    const agent = ctx.agents.list().find((item) => item.id === id)
    if (!agent) {
      // 冷会话尚无 Agent，仍通过官方投影还原已保存的下一模型，不把缺少驻留误判成未选模。
      const stored = await ctx.sessionController.inspect(id as Agent['id'])
      const restored = ctx.sessionProjections.restore(
        {},
        stored.events,
        SessionLogOffset(0),
        stored.meta,
        stored.inheritedEventCount,
      )
      return (
        restored.snapshot.values.modelSelection?.next ?? ctx.agentDefaultModel.currentSelection()
      )
    }
    const pending = ctx.sessionProjections.stateOf(agent.session, 'modelSelection')?.pending
    if (pending) return pending
    return agent.session.requestHeader()?.config ?? ctx.agentDefaultModel.currentSelection()
  })
  ctx.effect(() => () => controller.close())
  const initialize = async (id: string, seen = new Set<string>()): Promise<SessionEntry> => {
    if (sessions.entries.has(id)) return sessions.get(id)
    if (seen.has(id)) throw new Error('会话继承关系存在循环')
    seen.add(id)
    try {
      const agent = ctx.agents.list().find((item) => item.id === id)
      const header = agent?.session.header ?? (await persistence.stat(id))?.header
      if (!header) throw new Error('无法定位原生会话')
      const parent =
        header.parentSession ??
        (agent
          ? ctx.agents
              .list()
              .find((other) => other !== agent && ctx.agents.isOwnedBy(agent.id, other))?.id
          : undefined)
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
  ctx.on('llm/stream', (options, next) =>
    (async function* () {
      if (options.sessionId && ctx.agents.list().some((agent) => agent.id === options.sessionId))
        await initialize(options.sessionId)
      await guardRequest(controller, options)
      yield* next()
    })(),
  )
  const connection = Reflect.get(ctx, 'connection') as Connection
  connection.fetch.register({
    path: API,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
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
