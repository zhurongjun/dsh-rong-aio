import { exportMarkdown } from '../shared/markdown.ts'
import { resolveState, prefixMatches, type ResolvedState } from '../shared/state.ts'
import type { Command, ConfigView, Route, SessionView } from '../shared/protocol.ts'
import { ConfigStore } from './config-store.ts'
import { PromptCatalog } from './prompt-catalog.ts'
import type { Paths } from './paths.ts'
import type { SessionEntry, SessionStore } from './session-store.ts'
import { fingerprint, message, removeVersion, withFileLocks, writeVersion } from './files.ts'
import { selectionError } from './selection-error.ts'

/** 串联文件与纯解析器；同宿主的修改/捕获/冻结共用串行队列。 */
export class Controller {
  readonly configs: ConfigStore
  readonly catalog: PromptCatalog
  private tail: Promise<unknown> = Promise.resolve()
  private failureId = 0
  private active = true
  readonly paths: Paths
  readonly sessions: SessionStore
  readonly selectedRoute: (id: string) => Promise<Route | undefined>
  constructor(
    paths: Paths,
    sessions: SessionStore,
    selectedRoute: (id: string) => Promise<Route | undefined>,
  ) {
    this.paths = paths
    this.sessions = sessions
    this.selectedRoute = selectedRoute
    this.configs = new ConfigStore(paths)
    this.catalog = new PromptCatalog(paths)
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(() => {
      if (!this.active) throw new Error('破甲模式组件已停用')
      return operation()
    })
    this.tail = task.catch(() => {})
    return task
  }
  async close(): Promise<void> {
    this.active = false
    await this.tail
    await this.sessions.close()
  }
  fail(id: string, error: unknown): Error {
    const entry = this.sessions.entries.get(id)
    const text = message(error)
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
    if (entry.loadError)
      return {
        state: entry.state,
        source: 'session',
        status: 'invalid',
        editable: false,
        message: entry.loadError,
      }
    // 展示、选模和请求共用同一优先级：本会话快照 > 已捕获候选 > 本会话显式选择。
    if (!entry.frozen && entry.candidate) return entry.candidate.resolved
    if (!config && !entry.frozen && entry.state.name)
      throw new Error('破甲状态缺少模板目录或请求快照')
    return resolveState({
      session: entry.state,
      frozen: entry.frozen,
      prompts: config?.templates ?? [],
      errors: config?.errors,
    })
  }
  /** 关闭与冻结状态不读取模板目录；只有显式选择需要解析当前正文。 */
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
    // 可编辑会话读取目录供菜单展示；冻结浏览不访问目录，也不重复传输快照正文。
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
    const text = message(reason)
    if (notify) this.sessions.get(id).error = { id: noticeId, message: text }
    return selectionError(id, noticeId, text)
  }
  private async authorize(
    resolved: ResolvedState,
    selection: Route | (() => Promise<Route | undefined>),
  ): Promise<void> {
    if (resolved.status === 'invalid') throw new Error(resolved.message)
    // 明确关闭是解析结果，不凭模板存在、模型目录或旧通知推断是否需要授权。
    if (resolved.status === 'off') return
    const route = typeof selection === 'function' ? await selection() : selection
    if (!route) throw new Error('尚未选择有效模型，请先选择模型')
    const user = await this.configs.read()
    if (user.error) throw new Error(user.error)
    if (
      !user.value.whitelist.some(
        (item) => item.provider === route.provider && item.model === route.model,
      )
    )
      throw new Error(
        `模型未获破甲模式授权：${route.provider} / ${route.model}。请先选择兼容模型。`,
      )
  }
  /** 原生选模提交前调用；和改选/捕获共用队列，失败时绝不调用原生提交。 */
  async selectModel<T>(id: string, route: Route, commit: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const entry = this.sessions.get(id)
      try {
        const { resolved } = await this.sessionResolution(entry)
        await this.authorize(resolved, route)
      } catch (error) {
        // 选模调用者（原生菜单、/model 或第三方入口）负责呈现 RemoteResult。
        // 不再投递会话通知，避免选模 toast 与破甲轮询重复报告同一次拒绝。
        throw this.reject(id, error, false)
      }
      const result = await commit()
      entry.error = undefined
      return result
    })
  }
  /** 只采集当前宿主的显式草稿选择；冻结快照不再属于文件引用。 */
  references(): Record<string, string[]> {
    const refs: Record<string, string[]> = {}
    const add = (name: string | null | undefined, label: string) => {
      if (name) (refs[name] ??= []).push(label)
    }
    for (const [id, entry] of this.sessions.entries)
      if (!entry.frozen) add(entry.state.name, `未发送会话：${id}`)
    return refs
  }
  /** 装配前捕获，不在读取 UI 时调用。后续改选必须等当前请求结束。 */
  async capture(id: string): Promise<void> {
    const entry = this.sessions.get(id)
    if (entry.frozen) return
    entry.busy = true
    await this.exclusive(async () => {
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
  /** 分发边界：冻结前复核文件版本与实际路由。授权失败绝不写会话快照。 */
  async admit(id: string, route: Route, system: string, freeze: boolean): Promise<void> {
    await this.exclusive(async () => {
      const entry = this.sessions.get(id)
      const admit = async () => {
        if (entry.loadError) throw new Error(entry.loadError)
        const body = this.body(id)
        if (!entry.frozen && body) {
          const { config } = await this.context(entry.meta.cwd)
          if (entry.candidate?.revision !== config.revision)
            throw new Error('破甲词或白名单在请求准备期间发生变化，请重新发送')
        }
        await this.authorize(this.resolve(undefined, entry), route)
        if (body && !prefixMatches(system, body))
          throw new Error(
            '实际请求未包含破甲正文首段。当前完整系统预设或其他扩展不兼容，已阻止发送。',
          )
        if (!this.active) throw new Error('破甲模式组件已停用')
        if (freeze && !entry.frozen) {
          const candidate = entry.candidate!
          await this.sessions.persist(entry, {
            version: 1,
            state: candidate.resolved.state,
            source: candidate.resolved.source,
            frozen_at: new Date().toISOString(),
          })
          entry.candidate = undefined
        }
        if (!this.active) throw new Error('破甲模式组件已停用')
        entry.error = undefined
      }
      if (entry.frozen || entry.candidate?.resolved.status === 'off') await admit()
      else await withFileLocks(this.paths.locks(entry.meta.cwd), admit)
    })
  }
  async command(command: Command, workspace = ''): Promise<void> {
    await this.exclusive(async () => {
      if (command.type === 'acknowledge-error') {
        const entry = this.sessions.get(command.sessionId)
        // 通知是一次操作的结果，不是当前破甲状态。迟到确认不能清掉另一窗口的新错误。
        if (entry.error?.id === command.noticeId) entry.error = undefined
        return
      }
      if (command.type === 'select') {
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
        return
      }
      await withFileLocks(this.paths.locks(workspace), async () => {
        const { config, user } = await this.context(workspace)
        if (config.revision !== command.revision)
          throw new Error('文件已在其他窗口或编辑器中修改，请刷新后重试')
        if (command.type === 'save-template' || command.type === 'delete-template') {
          const previous = command.file
            ? config.templates.find((item) => item.file === command.file)
            : undefined
          if (command.file && !previous) throw new Error('原文件不存在或无法解析，请刷新')
          if (
            previous &&
            (command.type === 'delete-template' || command.template.name !== previous.name)
          ) {
            const refs = this.references()[previous.name] ?? []
            if (refs.length && !command.confirmed)
              throw new Error(`操作会使以下引用失效，请确认：${refs.join('；')}`)
          }
          if (command.type === 'delete-template') {
            await removeVersion(previous!.file, previous!.revision)
          } else {
            if (previous && previous.scope !== command.scope)
              throw new Error('编辑已有破甲词时不能更改存储位置')
            if (
              config.templates.some(
                (item) => item.file !== previous?.file && item.name === command.template.name,
              )
            )
              throw new Error('同名破甲词已存在，不能覆盖或跨层遮蔽')
            const file =
              previous?.file ??
              this.paths.newPrompt(command.scope, workspace, command.template.name)
            await writeVersion(
              file,
              exportMarkdown(command.template),
              previous?.revision ?? 'missing',
            )
          }
        } else {
          if (user.error) throw new Error(user.error)
          const value = structuredClone(user.value)
          value.whitelist = command.routes.filter(
            (route, index, routes) =>
              routes.findIndex(
                (other) => other.provider === route.provider && other.model === route.model,
              ) === index,
          )
          await this.configs.save(value, user.revision)
        }
      })
    })
  }
}
