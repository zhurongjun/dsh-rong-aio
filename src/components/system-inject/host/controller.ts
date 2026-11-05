/** 破甲业务协调器：统一解析、选词/选模校验、文件编辑及首次请求捕获和提交。 */

import { exportMarkdown } from '../shared/markdown.ts'
import { resolveState, prefixMatches, type ResolvedState } from '../shared/state.ts'
import type { Command, ConfigView, Route, SessionView } from '../shared/protocol.ts'
import { ConfigStore } from './config-store.ts'
import { PromptCatalog } from './prompt-catalog.ts'
import type { Paths } from './paths.ts'
import type { SessionEntry, SessionStore } from './session-store.ts'
import { fingerprint, message, removeVersion, withFileLocks, writeVersion } from './files.ts'
import { selectionError } from './selection-error.ts'

/**
 * 破甲模式的宿主事务边界。
 *
 * 会话展示、选模和实际请求复用同一解析顺序；模板编辑、选择及冻结共用串行队列。
 * 文件与快照由各 store 管理，本类只决定何时读取、校验和提交。
 * 队列拒绝不会阻塞后续任务；关闭后拒绝新任务并等待已经开始的操作结束。
 */
export class Controller {
  /** 用户白名单读写器；实际请求读取最新配置，不能使用浏览器缓存授权。 */
  readonly configs: ConfigStore

  /** 用户与当前工程的文件目录投影；仅未冻结的开启状态需要解析模板。 */
  readonly catalog: PromptCatalog

  /** 串行队列尾部；失败会被收敛为已完成，以便后续操作继续排队。 */
  private tail: Promise<unknown> = Promise.resolve()

  /** 当前组件生命周期内单调递增的通知 ID，防止迟到确认清掉新拒绝。 */
  private failureId = 0

  /** 关闭标记；在排队任务开始和请求提交边界再次检查。 */
  private active = true

  /** 用户与工程路径的唯一计算入口。 */
  readonly paths: Paths

  /** 宿主内存选择与会话伴随快照的权威存储。 */
  readonly sessions: SessionStore

  /** 惰性读取 DSH 当前选定路由；关闭状态不调用它。 */
  readonly selectedRoute: (id: string) => Promise<Route | undefined>

  /** 装配路径、会话存储与选模读取函数；构造时不扫描磁盘或恢复会话。 */
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

  /** 将操作排入宿主队列并透传其结果/错误；同一时刻仅执行一个修改事务。 */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(() => {
      if (!this.active) throw new Error('破甲模式组件已停用')
      return operation()
    })
    this.tail = task.catch(() => {})
    return task
  }

  /** 停止接收新事务，等待队尾完成，再释放会话内存；不删除磁盘数据。 */
  async close(): Promise<void> {
    this.active = false
    await this.tail
    await this.sessions.close()
  }

  /** 记录实际请求失败并返回可抛出的 Error。会话不存在时只返回错误，不创建状态。 */
  fail(id: string, error: unknown): Error {
    const entry = this.sessions.entries.get(id)
    const text = message(error)
    if (entry) entry.error = { id: ++this.failureId, message: text }
    return new Error(text, { cause: error })
  }

  /**
   * 读取指定范围的白名单和模板库，合成内容版本与诊断。
   * 读取失败进入 config.errors，不冒充有效空配置；此方法本身不授权任何模型。
   */
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

  /**
   * 统一优先级：恢复错误 → 本会话冻结快照 → 请求候选 → 显式选择。
   * 返回值是 UI 与护栏共用的结果；需要模板却缺少目录时抛错，避免猜测正文。
   */
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

  /**
   * 生成 HTTP 所需的只读视图。无 session ID 时只返回设置配置。
   * 可编辑会话扫描目录供菜单展示，冻结会话只读快照；不会调用提示词装配或触发冻结。
   */
  async view(id?: string, workspace = '') {
    const entry = id ? this.sessions.get(id) : undefined
    if (!entry) return { config: (await this.context(workspace)).config }

    // 可编辑会话读取目录供菜单展示；冻结浏览直接返回快照，不再附带模板目录。
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

  /** 构造未提交选择的结构化拒绝。notify=false 用于选模调用者自行呈现，避免重复 Toast。 */
  private reject(id: string, reason: unknown, notify = true) {
    const noticeId = ++this.failureId
    const text = message(reason)
    if (notify) this.sessions.get(id).error = { id: noticeId, message: text }
    return selectionError(id, noticeId, text)
  }

  /**
   * 核验已解析状态与精确路由；off 直接通过，invalid 或未授权时抛错。
   * selection 可以惰性读取当前路由；只有开启状态才读取最新用户白名单。
   */
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

    /** 关闭状态不形成引用；同一 name 保留全部已知会话标签供确认界面展示。 */
    const add = (name: string | null | undefined, label: string) => {
      if (name) (refs[name] ??= []).push(label)
    }

    for (const [id, entry] of this.sessions.entries)
      if (!entry.frozen) add(entry.state.name, `未发送会话：${id}`)
    return refs
  }

  /**
   * 首次装配前捕获不可变候选；已有快照直接复用。
   * 先标记 busy，再排队写入 pending 资格，阻止随后到达的并发改选。
   * 候选记录解析结果与文件版本；请求结束由 SessionStore.idle 清除临时占用。
   */
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

  /** 取得本次请求的固定正文；未捕获、恢复失败时抛错，关闭状态返回空字符串。 */
  body(id: string): string {
    const entry = this.sessions.get(id)
    if (entry.loadError) throw new Error(entry.loadError)
    if (!entry.frozen && !entry.candidate) throw new Error('请求尚未捕获破甲状态')
    return this.resolve(undefined, entry).state.snapshot?.body ?? ''
  }

  /**
   * 实际分发前复核最终路由、首段与捕获时的文件版本。
   *
   * freeze 表示普通会话请求；携带正文的辅助请求也校验，但不代替首次普通请求冻结。
   * 开启候选持有文件目录锁完成复核与落盘；冻结/关闭状态不依赖模板目录。
   * 快照先持久化，再允许调用适配器；任一步失败均抛错，绝不剥离正文后继续发送。
   */
  async admit(id: string, route: Route, system: string, freeze: boolean): Promise<void> {
    await this.exclusive(async () => {
      const entry = this.sessions.get(id)

      /** 在事务队列及必要目录锁内复核并提交；抛错意味着调用者不能分发请求。 */
      const admit = async () => {
        if (entry.loadError) throw new Error(entry.loadError)

        // 读取本次固定正文；开启候选重新核验文件版本，冻结快照不查模板库。
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

        // 原子持久化先于适配器调用，API 随后失败也不会解冻或重新取词。
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

  /**
   * 执行一种 HTTP 编辑命令。选择/通知只改会话，文件编辑还需跨进程锁与版本校验。
   * 失败向调用者抛错，禁止先改 UI 或原生模型再尝试回滚。
   */
  async command(command: Command, workspace = ''): Promise<void> {
    await this.exclusive(async () => {
      // 会话内存命令：通知确认和选词不进入文件编辑分支。
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

      // 文件编辑事务：共同读取组合版本，持锁校验后只提交对应文件。
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
