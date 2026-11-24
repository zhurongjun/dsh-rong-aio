import { fingerprint } from '../../../host/http.ts'
import { errorMessage } from '../../../shared/error.ts'
import { createSerialQueue } from '../../../shared/serial-queue.ts'
import { exportMarkdown } from './markdown.ts'
import { resolveState, prefixMatches, type ResolvedState } from '../shared/state.ts'
import type { Command, ConfigView, Route, SessionView } from '../shared/protocol.ts'
import { ConfigStore } from './config-store.ts'
import { PromptCatalog } from './prompt-catalog.ts'
import type { Paths } from './paths.ts'
import type { SessionEntry, SessionStore } from './session-store.ts'
import { removeVersion, withFileLocks, writeVersion } from './files.ts'
import { selectionError } from './guards.ts'

export class Controller {
  readonly configs: ConfigStore
  readonly catalog: PromptCatalog
  private readonly queue = createSerialQueue('破甲模式组件已停用')
  private failureId = 0

  constructor(
    readonly paths: Paths,
    readonly sessions: SessionStore,
    readonly selectedRoute: (id: string) => Promise<Route | undefined>,
  ) {
    this.configs = new ConfigStore(paths)
    this.catalog = new PromptCatalog(paths)
  }

  async close(): Promise<void> {
    await this.queue.close()
    await this.sessions.close()
  }

  fail(id: string, error: unknown): Error {
    const entry = this.sessions.entries.get(id)
    const text = errorMessage(error, String(error))
    if (entry) entry.error = { id: ++this.failureId, message: text }
    return new Error(text, { cause: error })
  }

  async context(workspace = '') {
    const [user, catalog] = await Promise.all([this.configs.read(), this.catalog.scan(workspace)])
    const errors = [user.error, ...catalog.errors].filter((item): item is string => !!item)

    const config: ConfigView = {
      revision: fingerprint(JSON.stringify([workspace, user.revision, catalog.revision, errors])),
      workspace,
      templates: catalog.prompts,
      whitelist: user.value.whitelist,
      paths: {
        user: this.paths.prompts('user'),
        ...(workspace ? { workspace: this.paths.prompts('workspace', workspace) } : {}),
      },
      errors,
    }
    return { config, user }
  }

  private resolve(config: ConfigView | undefined, entry: SessionEntry): ResolvedState {
    if (entry.loadError) {
      return {
        state: entry.state,
        source: 'session',
        status: 'invalid',
        editable: false,
        message: entry.loadError,
      }
    }

    if (!entry.frozen && entry.candidate) return entry.candidate.resolved
    if (!config && !entry.frozen && entry.state.name) {
      throw new Error('破甲状态缺少模板目录或请求快照')
    }

    return resolveState({
      session: entry.state,
      frozen: entry.frozen,
      prompts: config?.templates ?? [],
      errors: config?.errors,
    })
  }

  private async sessionResolution(entry: SessionEntry) {
    const config =
      entry.frozen || entry.loadError || entry.candidate || entry.state.name === null
        ? undefined
        : (await this.context(entry.meta.cwd)).config
    return { config, resolved: this.resolve(config, entry) }
  }

  async view(id?: string, workspace = '') {
    const entry = id ? this.sessions.get(id) : undefined
    if (!entry) return { config: (await this.context(workspace)).config }

    const config =
      entry.eligible && !entry.candidate && !entry.loadError
        ? (await this.context(entry.meta.cwd)).config
        : undefined

    const session: SessionView = {
      sessionId: entry.meta.id,
      workspace: entry.meta.cwd ?? '',
      inheritedFrom: entry.frozen?.inherited_from,
      resolved: this.resolve(config, entry),
      busy: entry.busy,
      error: entry.error,
    }
    return { config, session }
  }

  private reject(id: string, reason: unknown, notify = true) {
    const noticeId = ++this.failureId
    const text = errorMessage(reason, String(reason))
    if (notify) this.sessions.get(id).error = { id: noticeId, message: text }
    return selectionError(id, noticeId, text)
  }

  private async authorize(
    resolved: ResolvedState,
    selection: Route | (() => Promise<Route | undefined>),
  ): Promise<void> {
    if (resolved.status === 'invalid') throw new Error(resolved.message)
    if (resolved.status === 'off') return

    const route = typeof selection === 'function' ? await selection() : selection
    if (!route) throw new Error('尚未选择有效模型，请先选择模型')

    const user = await this.configs.read()
    if (user.error) throw new Error(user.error)

    if (
      !user.value.whitelist.some(
        (item) => item.provider === route.provider && item.model === route.model,
      )
    ) {
      throw new Error(
        `模型未获破甲模式授权：${route.provider} / ${route.model}。请先选择兼容模型。`,
      )
    }
  }

  async selectModel<T>(id: string, route: Route, commit: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      const entry = this.sessions.get(id)
      try {
        const { resolved } = await this.sessionResolution(entry)
        await this.authorize(resolved, route)
      } catch (error) {
        throw this.reject(id, error, false)
      }

      const result = await commit()
      entry.error = undefined
      return result
    })
  }

  references(): Record<string, string[]> {
    const refs: Record<string, string[]> = {}
    for (const [id, entry] of this.sessions.entries) {
      if (!entry.frozen && entry.state.name) {
        ;(refs[entry.state.name] ??= []).push(`未发送会话：${id}`)
      }
    }
    return refs
  }

  async capture(id: string): Promise<void> {
    const entry = this.sessions.get(id)
    if (entry.frozen) return

    entry.busy = true
    await this.queue.run(async () => {
      if (entry.candidate) return
      await this.sessions.markPending(entry)

      const { config, resolved } = await this.sessionResolution(entry)
      if (resolved.status === 'invalid') throw this.fail(id, new Error(resolved.message))

      entry.candidate = { resolved: structuredClone(resolved), revision: config?.revision }
      entry.error = undefined
    })
  }

  body(id: string): string {
    const entry = this.sessions.get(id)
    if (entry.loadError) throw new Error(entry.loadError)
    if (!entry.frozen && !entry.candidate) throw new Error('请求尚未捕获破甲状态')
    return this.resolve(undefined, entry).state.snapshot?.body ?? ''
  }

  async admit(id: string, request: Route & { purpose?: string }, system: string): Promise<void> {
    await this.queue.run(async () => {
      const entry = this.sessions.get(id)

      const executeAdmit = async () => {
        if (entry.loadError) throw new Error(entry.loadError)

        const body = this.body(id)
        if (!entry.frozen && body) {
          const { config } = await this.context(entry.meta.cwd)
          if (entry.candidate?.revision !== config.revision) {
            throw new Error('破甲词或白名单在请求准备期间发生变化，请重新发送')
          }
        }

        await this.authorize(this.resolve(undefined, entry), request)
        if (request.purpose !== 'auto-review' && body && !prefixMatches(system, body)) {
          throw new Error(
            '实际请求未包含破甲正文首段。当前完整系统预设或其他扩展不兼容，已阻止发送。',
          )
        }
        if (!this.queue.active) throw new Error('破甲模式组件已停用')

        if (!request.purpose && !entry.frozen) {
          const candidate = entry.candidate!
          await this.sessions.persist(entry, {
            version: 1,
            state: candidate.resolved.state,
            source: candidate.resolved.source,
            frozen_at: new Date().toISOString(),
          })
          entry.candidate = undefined
        }

        if (!this.queue.active) throw new Error('破甲模式组件已停用')
        entry.error = undefined
      }

      if (entry.frozen || entry.candidate?.resolved.status === 'off') await executeAdmit()
      else await withFileLocks(this.paths.locks(entry.meta.cwd), executeAdmit)
    })
  }

  private async selectPrompt(command: Extract<Command, { type: 'select' }>) {
    const entry = this.sessions.get(command.sessionId)
    try {
      if (!entry.eligible || entry.busy) throw new Error('会话已冻结或正在发送，不能改选')
      if (entry.loadError) throw new Error(entry.loadError)

      const config =
        command.state.name === null ? undefined : (await this.context(entry.meta.cwd)).config
      const candidate = this.resolve(config, { ...entry, state: command.state })
      await this.authorize(candidate, () => this.selectedRoute(command.sessionId))
    } catch (error) {
      throw this.reject(command.sessionId, error)
    }

    entry.state = { ...command.state }
    entry.error = undefined
  }

  private async applyTemplateCommand(
    command: Extract<Command, { type: 'save-template' | 'delete-template' }>,
    config: ConfigView,
    workspace: string,
  ) {
    const previous = command.file
      ? config.templates.find((item) => item.file === command.file)
      : undefined
    if (command.file && !previous) throw new Error('原文件不存在或无法解析，请刷新')

    if (
      previous &&
      (command.type === 'delete-template' || command.template.name !== previous.name)
    ) {
      const refs = this.references()[previous.name] ?? []
      if (refs.length && !command.confirmed) {
        throw new Error(`操作会使以下引用失效，请确认：${refs.join('；')}`)
      }
    }

    if (command.type === 'delete-template') {
      await removeVersion(previous!.file, previous!.revision)
      return
    }

    if (previous && previous.scope !== command.scope) {
      throw new Error('编辑已有破甲词时不能更改存储位置')
    }
    if (
      config.templates.some(
        (item) => item.file !== previous?.file && item.name === command.template.name,
      )
    ) {
      throw new Error('同名破甲词已存在，不能覆盖或跨层遮蔽')
    }

    const file =
      previous?.file ?? this.paths.newPrompt(command.scope, workspace, command.template.name)
    await writeVersion(file, exportMarkdown(command.template), previous?.revision ?? 'missing')
  }

  async command(command: Command, workspace = ''): Promise<void> {
    await this.queue.run(async () => {
      if (command.type === 'acknowledge-error') {
        const entry = this.sessions.get(command.sessionId)
        if (entry.error?.id === command.noticeId) entry.error = undefined
        return
      }

      if (command.type === 'select') {
        await this.selectPrompt(command)
        return
      }

      await withFileLocks(this.paths.locks(workspace), async () => {
        const { config, user } = await this.context(workspace)
        if (config.revision !== command.revision) {
          throw new Error('文件已在其他窗口或编辑器中修改，请刷新后重试')
        }

        if (command.type === 'whitelist') {
          if (user.error) throw new Error(user.error)
          const value = structuredClone(user.value)
          value.whitelist = command.routes.filter(
            (route, index, routes) =>
              routes.findIndex(
                (other) => other.provider === route.provider && other.model === route.model,
              ) === index,
          )
          await this.configs.save(value, user.revision)
          return
        }

        await this.applyTemplateCommand(command, config, workspace)
      })
    })
  }
}
