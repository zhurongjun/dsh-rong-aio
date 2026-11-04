# DSH 界面消费契约

本插件直接使用 DSH 的主题变量和公开控件。基线为 `0.2.1-rc.5`，官方提交 `b830ec950faba0a46dda564be3e2d854afed94f1`。目标是让中性视觉跟随宿主，同时保持模型选择器已有的流程、密度与特色运动。

## 来源与所有权

- 全局主题以官方 [ui-theme 样式源码](https://github.com/deepseek-ai/deepseek-harness/tree/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-theme/src/styles) 为准；参考 [Web 样式规范](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/web-styling.zh.md) 与[圆角规范](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/ui-radius.zh.md)。运行时由宿主负责主题、字体、平台与焦点模态。
- 控件只使用 `@deepseek-ai/dsh-client-ui-primitives` 的 [public export](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-primitives/src/index.ts)。不导入组件内部路径，不随包再提供 React 或主题实现。
- [消费清单](../scripts/ui-contract.json) 记录本项目直接使用的变量名称、用途、固定版本源码位置及局部例外。它是离线维护契约，不是全量 token 副本，也不向运行时注入值。组件内部引用的 token 由官方组件管理。
- `--dsh-composer-model-*-display` 是输入框布局契约，`--dsh-scrollbar-*` 是共享滚动条入口；不要把所有 `--dsh-*` 都视作全局主题颜色。

## 语义映射

| 用途                                  | 来源                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| 主文字、次文字、辅助图标              | `--dsw-alias-label-primary/secondary/tertiary`                                      |
| 强度摘要、不可用状态                  | `--dsw-alias-label-caption/dimmed`                                                  |
| DeepSeek 蓝：强度标题、填充、选中勾号 | `--dsw-alias-state-business-primary`                                                |
| 中性 hover                            | `--dsw-alias-interactive-bg-hover`                                                  |
| 边框、滑轨底色                        | `--dsw-alias-border-l1/l3`；L3 同样用于官方 Switch 的关闭轨道                       |
| 键盘焦点                              | `--dsw-focus-ring-width/color`；颜色以业务蓝作语义 fallback                         |
| 菜单表面                              | `MenuSurface` 的材质与平台 backing；主面板 16px，Fast 使用官方 compact 的 12px 圆角 |
| 弹层阴影、滚动条                      | `--dsw-elevation-prominent`、官方 scrollbar L2 语义                                 |
| 模型副标题 12/18                      | `--dsw-font-xxs-12`                                                                 |
| 其他 12、13、14px 正文                | 相应 `--dsw-font-*-font-size`，保留原有继承行高与字重                               |

`brand-primary` 是黑白中性色，不是 DeepSeek 蓝。主题变量会随浅色、深色、平台或用户设置改变；禁止把当前 computed RGB 复制为产品样式。只允许 `transparent`、`currentColor` 直接用于通用控件。

## 控件与布局

新界面优先使用官方 Button、Input、Tooltip、Modal、SettingsForm 等适合场景的公开组件。替换前确认尺寸、键盘行为及资源清理，不能仅因名字相同就替换。

现有主弹层与 Fast 子菜单使用 `MenuSurface`。插件不覆盖菜单填充、blur 或主题圆角；表面与 macOS 独立 backing 使用相同的官方形状。局部 elevation 描边色、scrollbar thumb 与 hover 重绑是明确支持的扩展点，限定在 `.rong-model-popover`。

Fast 子菜单使用公开 `compact` 属性，最小宽 96px，按档位名称自然扩展，单行高 30px，勾选列固定 16px。开启时从闪电一侧缩放、淡入 160ms，关闭时过渡 110ms 后移除；快速反向操作从当前帧继续，关闭期间立即停止交互。缩放原点随锚点和可用空间定位。菜单根节点只做 transform 过渡并在其挂载期间保持合成层，材质与内容分别淡入；根节点始终保持完全不透明，避免动画结束时切换背景采样范围。减少动态效果时立即开合。

Fast 动画依赖固定版本 [MenuSurface 的材质子层结构](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-primitives/src/MenuSurface.tsx)：首个 `aria-hidden` 直接子元素是材质层。仅在 `.rong-speed-menu` 内控制它的透明度，不改官方填充或 blur。升级时必须核对该结构和实际毛玻璃效果；禁止改回整个 MenuSurface 淡入，因为 [opacity 小于 1 会建立 Backdrop Root](https://drafts.csswg.org/filter-effects-2/#BackdropRoot)，导致结束时背景采样发生变化。

选择器保持主弹层 256×98px、24px 轨道、28px 圆形滑块及 26px 头部按钮。模型列表顶部仅保留返回键与搜索框，两者高 26px、间隔 6px；没有独立标题行，搜索框占据剩余宽度。列表弹层按内容收缩，空结果仍保留一行状态提示。14/20/600 强度标题没有等值官方排版角色，保留原值；搜索框和分组分隔线的 1px 是当前布局契约，不机械替换为改变盒尺寸的细边。其他组件几何、内部圆角与动画参数按功能维护，不要求每个数值都有 token。

Fast/Reset 使用现有 SVG，标准模式闪电空心、快速模式实心，hover 只增加背景。Fast 菜单保留 Tab 关闭的行为；官方 Menu 的 Tab 选中行为不同，因此这里继续使用表面原子配合现有逻辑。保持单层强度入口、模型搜索、明确 effort、重置和所有键盘操作。

进入模型列表时默认聚焦搜索框，可直接输入关键词。方向键移动高亮，Enter 选择，Esc 返回强度面板；Tab 在弹层的可交互控件之间移动。

## 局部装饰与运动

滑块白色、微阴影、粒子白色及光晕是有意的局部装饰，精确例外见消费清单；这些颜色不能借用到按钮、正文或菜单。圆与胶囊显式使用 `corner-shape: round`，其他菜单表面继承官方轮廓。

保持滑杆动力学、拖动提交时机、固定高度向左流动的粒子、已过档位点隐藏及 `prefers-reduced-motion`。通用 transition token 不等同于物理运动参数，不能统一替换。没有独立主题 store；需要 JS 主题状态时才接入官方主题服务。

## 检查与维护

`pnpm check:ui` 扫描 `src/` 中所有 `client/` 目录 的 CSS 和 JS/TS/JSX/TSX，且已纳入 `pnpm check`。CSS 通过 AST 检查：颜色字面量（含 fallback 与嵌套函数）、未知宿主变量、明暗分支、宿主变量重定义及精确例外。源码 AST 检查静态样式对象、SVG paint 属性、DOM style 赋值和 `setProperty`；颜色条件表达式逐个分支检查。动态颜色应通过 CSS 类表达，禁止 `cssText` 或 style 字符串注入。

这不是通用 CSS 类型检查或跨模块数据流分析器，不能证明任意运行时字符串拼接安全；代码审查仍需检查外部样式、动态注入和视觉语义。布局数值不作一刀切限制，实际材质和交互仍需在 DSH 中确认。

增加新 token 时先查固定版本官方声明，确认语义后更新清单并运行检查。增加装饰色需要具体用途与文件/选择器/属性/完整值约束，禁止整文件放行。升级 DSH 时同步复核清单、公开组件与平台实现，验证浅/深/系统主题、字体偏好、窄视口、长模型名、焦点/disabled 和减少动态效果；不从 upstream main 自动更新。
