import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  isAgentLoopRequest,
  type GenerateOptions,
  type RequestMessage,
  type ToolSchema,
  type ToolHistory,
} from '@deepseek-ai/dsh-llm'
import {
  deriveEventMessage,
  foldSurface,
  isReplacementSurfaceEvent,
  type SessionEvent,
  foldRequestHeader,
  type Session,
  type SessionStore,
} from '@deepseek-ai/dsh-session'
import * as z from 'zod'
import { isSideSession } from '../shared/protocol.ts'

export const prefixSchema = z.object({
  count: z.number().int().nonnegative(),
  messages: z.string(),
  tools: z.string(),
  offset: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
})
type Prefix = z.infer<typeof prefixSchema>

const digests = new WeakMap<RequestMessage, Buffer>()

function messageDigest(message: RequestMessage) {
  let digest = digests.get(message)
  if (!digest) {
    const value = message.role === 'system' ? [message.role, message.content] : message
    digest = createHash('sha256').update(JSON.stringify(value)).digest()
    if (Object.isFrozen(message)) digests.set(message, digest)
  }
  return digest
}

function messageHash(messages: readonly RequestMessage[], count: number) {
  const hash = createHash('sha256')
  for (let i = 0; i < count; i++) hash.update(messageDigest(messages[i]))
  return hash.digest('hex')
}

function toolHash(tools: readonly ToolSchema[] = [], history?: ToolHistory) {
  return createHash('sha256')
    .update(JSON.stringify([tools, history]))
    .digest('hex')
}

function matches(prefix: Prefix, messages: readonly RequestMessage[], tools: string) {
  return (
    prefix.tools === tools &&
    prefix.count <= messages.length &&
    prefix.messages === messageHash(messages, prefix.count)
  )
}

function checkpoint(session: Session, messages: readonly RequestMessage[], tools: string): Prefix {
  return {
    count: messages.length,
    messages: messageHash(messages, messages.length),
    tools,
    offset: session.seq,
    generation: session.surface.contentGeneration,
  }
}

export function forkPrefix(session: Session) {
  const header = session.requestHeader()
  if (header) {
    return checkpoint(
      session,
      session.deriveMessages(),
      toolHash(header.tools, session.toolHistory()),
    )
  }
}

function isCompactionEdit(event: SessionEvent, events: readonly SessionEvent[]) {
  if (String(event.type) === 'image/offload') return true
  if (!isReplacementSurfaceEvent(event)) return false
  if (event.type === 'user/message') return String(event.data.source.kind) === 'compact-checkpoint'
  return event.type === 'tool/result' && String(events[event.seq - 1]?.type) === 'compaction/prune'
}

async function matchesCompactedPrefix(
  ctx: Context,
  sessions: SessionStore,
  session: Session,
  prefix: Prefix,
  options: GenerateOptions,
) {
  if (session.surface.contentGeneration === prefix.generation) return false

  using cut = await ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
  const events = cut.events
  for (let index = events.length - 1; index >= prefix.offset; index--) {
    if (!isCompactionEdit(events[index], events)) continue

    const series = events.slice(0, index + 1)
    const surface = foldSurface(series, sessions.messageProjections)
    const messages = surface.nodes.flatMap(
      (seq) => deriveEventMessage(series[seq], surface.projectedMessages) ?? [],
    )
    return (
      messages.length <= options.messages.length &&
      messageHash(messages, messages.length) === messageHash(options.messages, messages.length) &&
      toolHash(foldRequestHeader(series)?.tools) === toolHash(options.tools)
    )
  }
  return false
}

export function protectPrefix(
  ctx: Context,
  sessions: SessionStore,
  read: (id: string) => Prefix | undefined,
  save: (id: string, prefix: Prefix) => Promise<unknown>,
) {
  const steps = new WeakMap<Session, Prefix>()

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const result = await next()
    const session = agent.session
    if (result.kind === 'reject' || !isSideSession(agent.id) || !session.header.isSeeded) {
      return result
    }

    const previous = read(agent.id)
    if (!previous) return result

    const messages = session.deriveMessages()
    const tools = toolHash(session.requestHeader()?.tools, session.toolHistory())
    steps.set(
      session,
      matches(previous, messages, tools) ? checkpoint(session, messages, tools) : previous,
    )
    return result
  })

  ctx.on('llm/stream', (options, next) => {
    const id = options.sessionId
    if (!id || !isSideSession(id) || !isAgentLoopRequest(options)) return next()

    const session = ctx.agents.get(id)?.session
    if (!session?.header.isSeeded) return next()

    return (async function* () {
      const prefix = steps.get(session) ?? read(id)
      const tools = toolHash(options.tools, options.toolHistory)
      if (
        prefix &&
        !matches(prefix, options.messages, tools) &&
        !(await matchesCompactedPrefix(ctx, sessions, session, prefix, options))
      ) {
        throw new Error(
          '侧聊请求的历史前缀或工具定义已改变。请恢复原来的提示词和工具配置，或从当前主会话新建侧聊。',
        )
      }

      const accepted = checkpoint(session, options.messages, tools)
      await save(id, accepted)
      steps.set(session, accepted)
      yield* next()
    })()
  })
}
