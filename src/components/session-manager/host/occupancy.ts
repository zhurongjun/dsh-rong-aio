import { Context, symbols, type Fiber } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
  ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import type { SessionHeader, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '../../../shared/session-events.ts'

const releasableHandles = new WeakMap<Agent, () => Promise<void>>()

function sessionControllerFibers(ctx: Context): Set<Fiber> {
  const fibers = new Set<Fiber>()
  for (const key of Object.getOwnPropertySymbols(ctx.reflect.store)) {
    const impl = ctx.reflect.store[key]
    if (impl?.name === 'sessionController' && impl.ctx.fiber !== ctx.root.fiber) {
      fibers.add(impl.ctx.fiber)
    }
  }
  return fibers
}

function isSessionControllerCaller(ctx: Context, callerCtx: unknown): boolean {
  if (!Context.is(callerCtx)) return false
  const fibers = sessionControllerFibers(ctx)
  if (!fibers.size) return false

  let current: Fiber | undefined = callerCtx.fiber
  while (current && current !== ctx.root.fiber) {
    if (fibers.has(current)) return true
    current = current.parent?.fiber
  }
  return false
}

export function installSessionOccupancy(ctx: Context): void {
  const service = ctx.agents
  const target = Reflect.get(service, symbols.original) ?? service
  const createDescriptor = Object.getOwnPropertyDescriptor(target, 'create')
  const resumeDescriptor = Object.getOwnPropertyDescriptor(target, 'resume')
  const originalCreate: (options: CreateAgentOptions) => Promise<AgentHandle> = target.create
  const originalResume: (options: ResumeAgentOptions) => Promise<AgentHandle> = target.resume

  let active = true
  const track = (caller: object, handle: AgentHandle) => {
    if (!active || handle.agent.session.header.origin === 'subagent') return handle
    if (isSessionControllerCaller(ctx, Reflect.get(caller, 'ctx'))) {
      releasableHandles.set(handle.agent, () => handle.dispose())
    }
    return handle
  }

  const wrappedCreate = async function (
    this: typeof service,
    options: CreateAgentOptions,
  ): Promise<AgentHandle> {
    const handle = await originalCreate.call(this, options)
    return track(this, handle)
  }

  const wrappedResume = async function (
    this: typeof service,
    options: ResumeAgentOptions,
  ): Promise<AgentHandle> {
    const handle = await originalResume.call(this, options)
    return track(this, handle)
  }

  Object.defineProperty(target, 'create', {
    configurable: true,
    writable: true,
    value: wrappedCreate,
  })
  Object.defineProperty(target, 'resume', {
    configurable: true,
    writable: true,
    value: wrappedResume,
  })

  ctx.on('agent/disposed', ({ agent }) => {
    releasableHandles.delete(agent)
  })

  ctx.effect(() => () => {
    active = false
    if (target.create === wrappedCreate) {
      if (createDescriptor) Object.defineProperty(target, 'create', createDescriptor)
      else delete (target as Partial<typeof target>).create
    }
    if (target.resume === wrappedResume) {
      if (resumeDescriptor) Object.defineProperty(target, 'resume', resumeDescriptor)
      else delete (target as Partial<typeof target>).resume
    }
  })
}

function isLiveSessionBusyOrUnreleasable(
  ctx: Context,
  sessions: SessionStore,
  id: SessionId,
  origin?: SessionHeader['origin'],
): boolean {
  const session = sessions.get(id)
  if (!session) return false
  if ((origin ?? session.header.origin) === 'subagent') return true
  if (ctx.bail('rong-aio/session-claim', id)) return true

  const agent = ctx.agents.get(id)
  if (!agent || agent.session !== session) return true
  if (!releasableHandles.has(agent)) return true
  if (agent.status !== 'idle') return true
  if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) return true

  const gateway = ctx.get('typertGateway') as
    { getPendingRemoteEvents?: () => ReadonlyArray<{ agentId?: unknown }> } | undefined
  if (gateway?.getPendingRemoteEvents?.().some((event) => String(event.agentId) === id)) {
    return true
  }

  return false
}

export async function inspectSessionBlock(
  ctx: Context,
  sessions: SessionStore,
  id: SessionId,
  origin?: SessionHeader['origin'],
  signal?: AbortSignal,
): Promise<'occupied' | 'active' | undefined> {
  signal?.throwIfAborted()
  if (isLiveSessionBusyOrUnreleasable(ctx, sessions, id, origin)) return 'occupied'

  const activity = await ctx.waterfall(
    'workspace/session-activity',
    { sessionId: id },
    async () => [],
  )
  signal?.throwIfAborted()
  if (activity.length > 0) return 'active'

  if (isLiveSessionBusyOrUnreleasable(ctx, sessions, id, origin)) return 'occupied'
  return undefined
}

export async function releaseIdleSession(
  ctx: Context,
  sessions: SessionStore,
  id: SessionId,
): Promise<void> {
  if (!sessions.get(id)) return

  const block = await inspectSessionBlock(ctx, sessions, id)
  if (block === 'active') {
    throw new Error('会话有正在进行的任务，请在任务结束后重试')
  }
  if (block === 'occupied') {
    throw new Error('会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
  }

  const session = sessions.get(id)
  if (!session) return

  const agent = ctx.agents.get(id)
  const dispose = agent && agent.session === session ? releasableHandles.get(agent) : undefined
  if (!agent || !dispose) {
    throw new Error('会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
  }

  let done!: Promise<void>
  try {
    void agent.runMaintenance(() => {
      done = dispose()
      return Promise.resolve()
    })
  } catch {
    throw new Error('会话仍被 DSH 占用；请在释放会话或重启 DSH 后重试')
  }
  releasableHandles.delete(agent)
  await done
}
