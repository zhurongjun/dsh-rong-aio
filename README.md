# dsh-rong-aio

自用、一个安装入口包含多个功能组件的 DeepSeek Harness 插件，支持 **DSH `0.2.2-rc.5` 和 `0.2.2-rc.3`** 的 Desktop 与 Web。

包含四个可独立启停的功能组件：**模型选择器**提供紧凑的模型、effort、Fast 与 Agent Team 控制；**破甲模式**提供文件破甲词库、新会话显式授权、冻结快照和精确模型白名单；**会话管理**提供归档、复原与永久删除；**侧聊**支持从主会话分叉问答、单独审批与恢复历史。界面使用 DSH 主题与公开控件。

## 安装

发布到 npm 后，推荐在 **DSH Desktop → 插件 → 添加插件** 中填写包名，安装完成后点击“立即启用”。

```text
dsh-rong-aio
```

DSH Web 用户可将同一个 npm 包添加到 `web` profile：

```sh
dsh plugin --profile web add dsh-rong-aio
```

包名默认安装稳定版。需要固定版本时填写 `dsh-rong-aio@<版本号>`，试用已发布的预发布版时填写 `dsh-rong-aio@next`。在自行管理依赖的 npm 项目中，可以执行 `npm install dsh-rong-aio` 将包加入项目依赖。

首次 npm 发布前，或无法访问 npm 时，可从 [GitHub Releases](https://github.com/zhurongjun/dsh-rong-aio/releases) 复制对应版本的 `.tgz` 附件地址，填入同一个安装入口。npm 包和 Release 附件都已包含运行产物。Git 源码安装仍可使用 `github:zhurongjun/dsh-rong-aio#<完整提交 SHA>`，需要宿主具备构建环境并允许精确来源的脚本。

本地开发执行 `pnpm install --frozen-lockfile`，安装结束会自动构建，再运行 `pnpm check`；随后在 DSH 中添加源码目录绝对路径。`pnpm pack` 同样自动构建，生成的安装包无需开发依赖或安装时构建。`lib/` 仍不提交。

## 使用

破甲模式组件默认开启但不注入任何内容。在设置中创建模板并授权精确模型后，每个独立新会话都必须显式选词开启；首次有效请求冻结正文，已有会话与模板后续编辑互不影响。

- 打开模型按钮直接调整强度，点击标题进入可搜索、按提供商分组的模型列表。
- 拖动只更新预览；松手保存一次。方向键逐档调整，Home/End 跳转两端。
- 切换模型与重置优先使用该模型明确配置的默认强度；未配置时选 Medium，否则首个非 Off 档。
- 旧会话没有明确强度时显示“请选择强度”；无推理档位的模型显示说明，不虚构滑块。
- Fast 和 reset 默认为灰色，悬停只增加圆角背景；闪电标准时空心、快速/超快时实心。速度选择按会话和模型保存，重启后保留。
- Agent Team 位于 Fast 右侧，与原生会话状态同步；有请求历史时关闭需确认，子会话不显示。
- Esc 从模型列表返回滑块，再按一次关闭；点击外部关闭。
- 滑轨固定淡蓝填充，粒子向左流动；已经过的圆点隐藏，本插件动画独立于系统“减少动态效果”配置。

## 目录与开发

```text
src/
├── client/                       # 根客户端公共 HTTP、Store 与弹窗组件
├── host/                         # 根宿主适配、会话定位与 HTTP 公共工具
├── shared/                       # 跨组件共用错误、队列与纯模型检索工具
├── runtime/host/                 # 组件装配与生命周期
└── components/
    ├── model-selector/           # 模型、effort、Fast 与 Agent Team
    ├── session-manager/          # 会话归档、复原与磁盘清理
    ├── side/                     # 侧聊分叉、审批与历史恢复
    └── system-inject/            # 破甲词、会话冻结与模型护栏
tools/
├── build.ts                      # 统一校验清单并生成组件入口与 DSH 模块工厂
├── manifest.ts                   # 根包、子组件清单与 cordis.patch.yml 校验
├── verify-package.ts             # 发布包白名单、导出及隔离安装验收
└── lint/                         # 边界检查（含 CSS @import）与 UI 契约检查
tests/                            # 契约、集成与 Bombadil 浏览器 UI 测试
```

用户只安装 `dsh-rong-aio`，在 DSH 原生“包含的组件”中分别启停完整功能；总开关控制全部组件。新功能默认开启，已关闭组件沿用当前 profile 的覆盖状态。内部清单随根包分发，不单独安装。

Host 不导入 Client；Client 不导入 Host 或 Node；Shared 不依赖任一侧实现或 DOM。组件不相互导入内部实现，确有跨组件契约时才建立根 `src/shared/`，当前组件之间没有业务依赖。项目内部使用相对 ESM 导入。

界面直接消费 DSH 的语义 token 与公开控件；中性色、菜单材质和字体跟随宿主，保留选择器的布局与特色交互。新增界面遵守 `tools/lint/ui-contract.json`，通过 `pnpm lint` 统一检查目录文档、依赖边界、清单一致性及 UI token 契约。

开发环境：Node.js `^22.19.0 || >=24.0.0`、pnpm `11.25.0`。依赖固定版本，锁文件随源码提交。`pnpm-workspace.yaml` 配置 esbuild 及原生 JSONL 集成测试所需 koffi 的开发安装脚本许可与本地依赖缓存位置，只有根包参与依赖安装。

| 命令                                               | 用途                                               |
| -------------------------------------------------- | -------------------------------------------------- |
| `pnpm format`                                      | 格式化源码、配置、工具脚本与中文文档               |
| `pnpm format:check`                                | 只检查格式                                         |
| `pnpm lint` / `pnpm lint:fix`                      | 运行 Oxlint 与工程契约检查（边界、UI token、清单） |
| `pnpm typecheck`                                   | 检查源码、工具脚本与 TS 测试类型                   |
| `pnpm test`                                        | 运行 Node 契约/集成测试与 Bombadil 浏览器 UI 测试  |
| `pnpm check`                                       | 依次检查格式、lint、类型和测试，不改写源码         |
| `pnpm build`                                       | 生成可安装的 `lib/`                                |
| `pnpm pack --pack-destination agent_temp/packages` | 自动构建并打成安装包                               |
| `pnpm verify:package`                              | 验证 `.tgz` 内容、导出闭合及 pnpm/npm 离线隔离安装 |

每次向任意分支推送提交或更新 PR，`ci.yml` 都会执行完整检查、构建、打包与隔离安装验证。

推送与根包和组件版本一致的新 `v<版本号>` Tag 后，`publish.yml` 会对该 Tag 调用同一套 CI 验证，再将验证过的安装包发布到 npm。维护者在 npm 的 Trusted Publisher 设置中填写工作流文件名 `publish.yml`。稳定版使用 `latest`，预发布版（如 `v0.2.0-rc.1`）使用 `next`。GitHub Release 随后提供同一个 `.tgz` 和 SHA-256 校验文件。保留已有 [GPL v3 许可证](LICENSE)。
