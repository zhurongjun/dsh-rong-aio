import { isAbsolute, join, resolve, basename } from 'node:path'
import { nameSchema, type Scope } from '../shared/state.ts'

/** 工程边界严格等于 DSH 会话工作区，不进行父目录或 Git 根目录搜索。 */
export class Paths {
  readonly user: string
  constructor(user: string) {
    if (!isAbsolute(user)) throw new Error('破甲模式用户目录必须是绝对路径')
    this.user = resolve(user)
  }
  base(scope: Scope, workspace = ''): string {
    if (scope === 'user') return this.user
    if (!workspace || !isAbsolute(workspace)) throw new Error('请先选择工作区')
    return join(workspace, '.dsh', 'system_inject')
  }
  config(): string {
    return join(this.user, 'config.json')
  }
  prompts(scope: Scope, workspace = ''): string {
    return join(this.base(scope, workspace), 'prompts')
  }
  newPrompt(scope: Scope, workspace: string, name: string): string {
    nameSchema.parse(name)
    if (name.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
      throw new Error('name 不能用作跨平台文件名，请换一个短标识')
    const file = name + '.md'
    if (basename(file) !== file) throw new Error('无效文件名')
    return join(this.prompts(scope, workspace), file)
  }
  locks(workspace = ''): string[] {
    return [this.user, ...(workspace ? [this.base('workspace', workspace)] : [])]
  }
}
