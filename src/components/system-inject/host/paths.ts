/** 集中计算用户与工程文件路径；工作区只取 DSH 提供的精确根目录。 */

import { isAbsolute, join, resolve, basename } from 'node:path'
import { nameSchema, type Scope } from '../shared/state.ts'

/**
 * 统一文件布局与保存范围的路径规则。
 *
 * 用户目录由宿主 DSH_HOME 服务确定；工程边界严格等于原生会话工作区。
 * 本类只构造路径和验证新文件名，不创建目录，也不进行父目录或 Git 根目录搜索。
 */
export class Paths {
  /** 绝对规范化的 $DSH_HOME/system_inject 路径。 */
  readonly user: string

  /** 接受宿主提供的绝对用户目录；相对路径直接拒绝，避免随 cwd 漂移。 */
  constructor(user: string) {
    if (!isAbsolute(user)) throw new Error('破甲模式用户目录必须是绝对路径')
    this.user = resolve(user)
  }

  /** 返回指定范围目录；工程范围要求明确的绝对工作区，不向父目录查找。 */
  base(scope: Scope, workspace = ''): string {
    if (scope === 'user') return this.user
    if (!workspace || !isAbsolute(workspace)) throw new Error('请先选择工作区')
    return join(workspace, '.dsh', 'system_inject')
  }

  /** 返回唯一的用户白名单配置文件路径。 */
  config(): string {
    return join(this.user, 'config.json')
  }

  /** 返回指定范围的 prompts 目录；目录不存在由扫描层解释为空库。 */
  prompts(scope: Scope, workspace = ''): string {
    return join(this.base(scope, workspace), 'prompts')
  }

  /** 校验短标识及跨平台文件名并生成 name.md；不读取磁盘，冲突由写入层检测。 */
  newPrompt(scope: Scope, workspace: string, name: string): string {
    nameSchema.parse(name)
    if (name.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
      throw new Error('name 不能用作跨平台文件名，请换一个短标识')
    const file = name + '.md'
    if (basename(file) !== file) throw new Error('无效文件名')
    return join(this.prompts(scope, workspace), file)
  }

  /** 返回本次编辑涉及的目录锁集合；最终排序与去重由文件事务层完成。 */
  locks(workspace = ''): string[] {
    return [this.user, ...(workspace ? [this.base('workspace', workspace)] : [])]
  }
}
