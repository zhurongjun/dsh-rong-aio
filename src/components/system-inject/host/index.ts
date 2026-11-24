import type {} from '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  etagJsonResponse,
  jsonResponse,
  parseJsonBody,
  registerJsonEndpoint,
} from '../../../host/http.ts'
import { sessionDirectory, sessionRoot } from '../../../host/session-location.ts'
import { API, isInjectSelectionError, type StateView } from '../shared/protocol.ts'
import { Controller } from './controller.ts'
import { currentModel, guardRequest, hasRequestHistory, installSelectionGuard } from './guards.ts'
import { exportMarkdown, importMarkdown } from './markdown.ts'
import { Paths } from './paths.ts'
import { rpcSchema } from './schemas.ts'
import { SessionStore, type SessionEntry, type SessionMeta } from './session-store.ts'

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

async function loadCatalogRoutes(ctx: Context) {
  const catalogErrors: string[] = []
  const routes = (
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
  return { routes, catalogErrors }
}

export async function apply(ctx: Context): Promise<void> {
  if (!ctx.dshHomePath) throw new Error('DSH 未提供用户目录解析服务')

  const paths = new Paths(ctx.dshHomePath('system_inject'))
  const nativeSessions = ctx.sessions
  const persistence = ctx.sessionPersistence

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
      return await sessions.initialize(
        meta,
        parent ? () => initialize(parent, new Set(seen)) : undefined,
      )
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
    sessions.evictIfCold(agent.id)
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
      if (options.sessionId && ctx.agents.list().some((agent) => agent.id === options.sessionId)) {
        await initialize(options.sessionId)
      }
      await guardRequest(controller, options)
      yield* next()
    })(),
  )

  registerJsonEndpoint(ctx, {
    path: API,
    errorStatus: 409,
    formatError: (error) => ({
      message: error instanceof Error ? error.message : '无法读取或保存破甲设置',
      ...(isInjectSelectionError(error)
        ? {
            code: (error as { code: string }).code,
            details: (error as { details: unknown }).details,
          }
        : {}),
    }),
    async fetch(request) {
      let parsedCommand
      if (request.method === 'POST') {
        const parsed = await parseJsonBody(
          request,
          rpcSchema,
          '设置格式无效，请检查名称、正文和精确模型标识',
        )
        if (parsed.type === 'parse-markdown') {
          return jsonResponse({ prompt: importMarkdown(parsed.markdown) })
        }
        if (parsed.type === 'format-markdown') {
          return jsonResponse({ markdown: exportMarkdown(parsed.template) })
        }
        parsedCommand = parsed
      }

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
      ) {
        throw new Error('工作区未在 DSH 中注册')
      }

      if (parsedCommand) {
        if ('sessionId' in parsedCommand) await initialize(parsedCommand.sessionId)
        await controller.command(parsedCommand, workspace)
      }

      const view = await controller.view(id, workspace)
      const { routes, catalogErrors } = id
        ? { routes: [], catalogErrors: [] }
        : await loadCatalogRoutes(ctx)

      const data: StateView = {
        ...view,
        references: id ? {} : controller.references(),
        routes,
        catalogErrors,
      }
      return etagJsonResponse(request, data)
    },
  })
}
