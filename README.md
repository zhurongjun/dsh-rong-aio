# dsh-rong-aio

自用、单包的 DeepSeek Harness 插件，验证基线为 **DSH `0.2.1-rc.5`**，支持 Desktop 与 Web。

首个功能是 **Codex 风格的模型与推理强度选择器**：打开即显示强度滑块，点击标题切换模型；按 Codex 参考图调整比例、字号和图标，接入 DSH 的主题与会话状态。只提供目录实际声明的明确 effort，不显示 Default。左上角闪电按人工维护的 OpenAI / Anthropic 型号规则启用，菜单提供该型号支持的标准、快速或超快；宿主向实际 API 请求传递速度参数。

## 安装

推荐在 **DSH Desktop → 插件 → 添加插件** 中填写：

```text
github:zhurongjun/dsh-rong-aio#<完整提交 SHA>
```

将占位符替换为已推送提交。首次安装需允许该 Git 包的构建脚本；`prepare` 会自动安装开发依赖并生成运行产物，完成后点击“立即启用”。也可以省略 `#<完整提交 SHA>` 安装默认分支最新版本。

本地开发执行 `pnpm install --frozen-lockfile`，安装结束会自动构建，再运行 `pnpm check`；随后在 DSH 中添加源码目录绝对路径。`pnpm pack` 同样自动构建，生成的安装包无需开发依赖或安装时构建。`lib/` 仍不提交。

首次脚本许可、Web 安装、固定版本、卸载与回退见[安装说明](docs/installation.md)。

## 使用

- 打开模型按钮直接调整强度，点击标题进入可搜索、按提供商分组的模型列表。
- 拖动只更新预览；松手保存一次。方向键逐档调整，Home/End 跳转两端。
- 切换模型与重置优先使用该模型明确配置的默认强度；未配置时选 Medium，否则首个非 Off 档。
- 旧会话没有明确强度时显示“请选择强度”；无推理档位的模型显示说明，不虚构滑块。
- Fast 和 reset 默认为灰色，悬停只增加圆角背景；闪电标准时空心、快速/超快时实心。速度选择按会话和模型保存，重启后保留。
- Esc 从模型列表返回滑块，再按一次关闭；点击外部关闭。
- 滑轨固定淡蓝填充，粒子向左流动；已经过的圆点隐藏，系统“减少动态效果”生效。

完整约定、兼容边界和动画依据见[选择器说明](docs/model-selector.md)。

## 目录与开发

```text
src/
├── host/index.ts                  # 速度设置持久化与请求参数适配
├── client/model-selector/         # 组件、交互和样式
└── shared/                        # 模型选择规则和运动计算
scripts/build.mjs                  # DSH 模块工厂构建
tests/                            # 规则、运动及组件交互测试
```

Host 不导入 Client；Client 不导入 Host 或 Node；Shared 不依赖任一侧实现或 DOM。项目内部使用相对 ESM 导入。

界面直接消费 DSH 的语义 token 与公开控件；中性色、菜单材质和字体跟随宿主，保留选择器的布局与特色交互。新增界面遵守 [UI 消费契约](docs/ui-contract.md)，使用 `pnpm check:ui` 检查颜色、token 与局部例外。

开发环境：Node.js `^22.19.0 || >=24.0.0`、pnpm `11.25.0`。依赖固定版本，锁文件随源码提交。`pnpm-workspace.yaml` 配置 esbuild 的开发安装脚本许可及本地依赖缓存位置，仍是单包项目。

| 命令                                               | 用途                                                |
| -------------------------------------------------- | --------------------------------------------------- |
| `pnpm format`                                      | 格式化源码、配置与中文文档                          |
| `pnpm format:check`                                | 只检查格式                                          |
| `pnpm lint` / `pnpm lint:fix`                      | 检查代码与导入边界 / 安全修复                       |
| `pnpm typecheck`                                   | 检查 DSH 契约与组件类型                             |
| `pnpm check:ui`                                    | 检查 UI token、颜色与主题所有权                     |
| `pnpm test`                                        | 规则、动画计算与 DOM 交互测试                       |
| `pnpm check`                                       | 依次检查格式、lint、UI 契约、类型和测试，不改写源码 |
| `pnpm build`                                       | 生成可安装的 `lib/`                                 |
| `pnpm pack --pack-destination agent_temp/packages` | 自动构建并打成安装包                                |

没有 CI、提交钩子、自动发布或自动提交。保留已有 [GPL v3 许可证](LICENSE)。
