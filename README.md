# dsh-rong-aio

自用、一个安装入口包含多个功能组件的 DeepSeek Harness 插件，支持 **DSH `0.2.2-rc.3`** 的 Desktop 与 Web。

包含两个独立组件：**模型选择器**提供紧凑的模型、effort、Fast 与 Agent Team 控制；**破甲模式**提供文件破甲词库、新会话显式授权、冻结快照和精确模型白名单。界面使用 DSH 主题与公开控件，各组件独立启停。

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
├── components/
│   ├── model-selector/           # 模型、effort、Fast 与 Agent Team
│   └── system-inject/            # 破甲词、会话冻结与模型护栏
└── runtime/host/                 # 组件装配与生命周期
scripts/build.mjs                 # 统一生成组件入口与 DSH 模块工厂
tests/                            # 规则、装配生命周期、运动及交互测试
```

用户只安装 `dsh-rong-aio`，在 DSH 原生“包含的组件”中分别启停完整功能；总开关控制全部组件。新功能默认开启，已关闭组件沿用当前 profile 的覆盖状态。内部清单随根包分发，不单独安装。

Host 不导入 Client；Client 不导入 Host 或 Node；Shared 不依赖任一侧实现或 DOM。组件不相互导入内部实现，确有跨组件契约时才建立根 `src/shared/`，当前组件之间没有业务依赖。项目内部使用相对 ESM 导入。

界面直接消费 DSH 的语义 token 与公开控件；中性色、菜单材质和字体跟随宿主，保留选择器的布局与特色交互。新增界面遵守 `scripts/ui-contract.json`，使用 `pnpm check:ui` 检查颜色、token 与局部例外。

开发环境：Node.js `^22.19.0 || >=24.0.0`、pnpm `11.25.0`。依赖固定版本，锁文件随源码提交。`pnpm-workspace.yaml` 配置 esbuild 及原生 JSONL 集成测试所需 koffi 的开发安装脚本许可与本地依赖缓存位置，只有根包参与依赖安装。

| 命令                                               | 用途                                                |
| -------------------------------------------------- | --------------------------------------------------- |
| `pnpm format`                                      | 格式化源码、配置与中文文档                          |
| `pnpm format:check`                                | 只检查格式                                          |
| `pnpm lint` / `pnpm lint:fix`                      | 检查源码目录、代码与导入边界 / 安全修复             |
| `pnpm typecheck`                                   | 检查 DSH 契约与组件类型                             |
| `pnpm check:ui`                                    | 检查 UI token、颜色与主题所有权                     |
| `pnpm test`                                        | 规则、动画计算与 DOM 交互测试                       |
| `pnpm check`                                       | 依次检查格式、lint、UI 契约、类型和测试，不改写源码 |
| `pnpm build`                                       | 生成可安装的 `lib/`                                 |
| `pnpm pack --pack-destination agent_temp/packages` | 自动构建并打成安装包                                |

每次向任意分支推送提交或更新 PR，`ci.yml` 都会执行完整检查、构建、打包与隔离安装验证。

推送与根包和组件版本一致的新 `v<版本号>` Tag 后，`publish.yml` 会对该 Tag 调用同一套 CI 验证，再将验证过的安装包发布到 npm。维护者在 npm 的 Trusted Publisher 设置中填写工作流文件名 `publish.yml`。稳定版使用 `latest`，预发布版（如 `v0.2.0-rc.1`）使用 `next`。GitHub Release 随后提供同一个 `.tgz` 和 SHA-256 校验文件。保留已有 [GPL v3 许可证](LICENSE)。
