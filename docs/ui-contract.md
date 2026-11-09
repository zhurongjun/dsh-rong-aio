# DSH 界面消费契约

破甲模式使用官方 Button、Input、Menu、Modal、Toast、SegmentedTabs、PathLabel 与线性图标。编辑器的保存位置由 `ScopeChoice` 使用官方 Button 和 Menu 组合，采用标准菜单密度、尾部勾选和辅助信息右对齐；弹层定位、材质、键盘导航和焦点恢复交给宿主。触发按钮仅调整至 32px 高及 13/20 排版，与紧凑表单对齐，不重写中性颜色或交互状态。

rc.5 没有公开独立 Select 或长正文 Textarea；不导入内部 ConfigField，也不将只有短草稿语义的 InlineEditor 用于破甲词正文。正文编辑和快照阅读保留 textarea，消费官方语义 token。输入框光晕以 rc.5 的 `data-composer-card` 锚点和本组件标记限定范围，仅占用 `::before`，不修改编辑器或宿主 `::after`；升级时必须复核该 DOM 锚点。光晕使用错误红、panel 圆角与官方运动曲线，减少动态效果时禁用过渡。

设置分类使用中性裂盾，复用输入框已开启时的 SVG；输入框未开启时仍是完整盾牌。`0.2.2-rc.1` 通过公开 `settings.section.icon` 插槽按分类 ID 渲染图标，尺寸由设置外壳传入。`0.2.1-rc.5` 的设置外壳直接渲染齿轮 SVG，`SettingsNavIcon` 通过公开 `settings.action` 生命周期定位本分类，为其添加独立装饰节点并隐藏相邻齿轮。只有分类名称唯一且首个子元素是 SVG 才装饰。卸载清理观察器及节点，升级时复核该 DOM 适配。

新会话入口打开选择菜单，已有会话入口隐藏右侧展开箭头，直接打开只读快照 Modal，分支完全由宿主 `resolved.editable` 决定。选词后立即关闭菜单，再等待宿主校验。本包选词、选模和请求护栏的拒绝通过官方 Toast 提示，不使用拒绝 Modal 或重复内联错误；保留原有名称、图标和光晕。Toast 使用官方警告图标，水平对齐输入框，保持默认材质及入退场动画；本包提示停留 5 秒，不接管焦点、不阻止重试。目录加载失败继续保留菜单内的重试入口；原生 `/model` 沿用 DSH 自身的内联拒绝提示，不改写其控制器或 DOM。

破甲选择菜单不设搜索框，使用与左侧 PermissionSelect 相同的标准 Menu 密度：单行 34px、13/20 排版及官方行内边距，不启用 compact。基础选项仅保留“关闭”，不提供默认规则或继承入口。所有选择项、重试和管理入口保持等高，预留相同图标列；模板来源在同一行最右侧对齐，继承字号并使用辅助文字色。菜单随内容自然定宽，沿用官方 144–360px 宽度范围，并保证距视口两侧至少 12px；长名称与说明各自省略，不折行或产生横向滚动，名称至少保留两个字宽。完整名称可悬停查看。

破甲模式的模态窗由组件内 `Dialog` 组织紧凑内容，直接使用官方 Modal 的 `headless` 接口；遮罩、表面、动画、焦点、Escape 与嵌套层级仍由宿主管理，不覆盖官方内部类。内容边距 16px，标题、主体和底部操作间隔 12px；标题和操作不参与内容滚动。提示和确认窗按内容收缩，正文不叠加浏览器默认段落边距；有影响的引用以独立列表强调。

模板库参考 rc.5 内置插件目录的分组与卡片布局：顶部官方 Input 搜索栏，下方“全局”“工程”独立折叠分组，全局入口只显示全局组。分组行高 36px，卡片两列、间隔 10px，容器宽度不超过 520px 时改为单列。卡片直接消费官方 settings-card 的填充、描边及 xl 圆角；名称 14/20/500，简介 12/18、最多两行，短标识使用宿主代码字体和模块底色。点击卡片编辑，独立的官方 Menu 提供编辑、导出与删除。搜索匹配名称、短标识、简介，输入时展开两组，允许继续手动折叠；编辑返回保留搜索与折叠状态。空组和无匹配分别提示，不隐藏工程范围。

模型白名单使用双行矮卡片：模型名在上、提供商在下，10×12px 内边距、md 圆角和 L1 背景，右侧官方垃圾桶按钮使用错误红；与模板卡片的 xl 圆角、描述及短标识区分。顶部为官方 Input 搜索和新增按钮。新增浮层使用 MenuSurface 及公开定位/模态钩子，布局对齐模型选择器二级页（256px 宽、26px 返回与搜索、提供商分组和相同行密度）；不依赖选择器组件启用，也不调用会话选模。已授权项置灰并显示勾选，方向键跳过不可选项；中文输入法确认不触发新增，Escape 返回、恢复新增按钮焦点。显示名称与授权 ID 分离，卡片/菜单搜索同时匹配显示名和精确 ID，配置仍只保存 provider + model。

管理窗口宽度上限 680px，编辑器上限 860px；编辑器左侧 220px 集中显示元信息，右侧正文优先分配剩余宽度及视口高度。设置内容不足 600px 时改为上方双列元信息、下方正文，不足 360px 时字段单列排列。模板名和实际模型标识为主文字，来源、路径和说明为辅助文字。只读快照将复制放在标题栏，正文使用主要阅读区域；关闭状态的快照按短提示尺寸显示。高度始终受官方 Modal 可用区域约束，短窗口通过内容滚动保持操作可达。

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

破甲模式的输入框入口与 rc.5 原生 PermissionSelect 对齐：28px 高、14px 图标、13/20/500 排版、4px 内部间隔及相同中性 hover/focus。入口左侧间距收紧为 4px，跟随 composer 的 560px 容器断点调整；不改其他宿主控件。关闭时使用官方完整盾牌与次级文字色；有效 resolve 结果立即展示显示名称、光晕及同轮廓裂盾，不区分发送前后，也不按模型预览改变状态。失效引用显示“已失效”，发送时由宿主拒绝并显示 Toast。菜单使用官方勾选图标标识当前选择。有效选择，图标与模板名共用错误主色 60% 与警告主色 40% 的橘红色，随宿主明暗主题变化。展开箭头沿用官方 caption 色与 120ms 翻转，减少动态效果时直接切换。

现有主弹层与 Fast 子菜单使用 `MenuSurface`。插件不覆盖菜单填充、blur 或主题圆角；表面与 macOS 独立 backing 使用相同的官方形状。局部 elevation 描边色、scrollbar thumb 与 hover 重绑是明确支持的扩展点，限定在 `.rong-model-popover`。

Fast 子菜单使用公开 `compact` 属性，最小宽 96px，按档位名称自然扩展，单行高 30px，勾选列固定 16px。开启时从闪电一侧缩放、淡入 160ms，关闭时过渡 110ms 后移除；快速反向操作从当前帧继续，关闭期间立即停止交互。缩放原点随锚点和可用空间定位。菜单根节点只做 transform 过渡并在其挂载期间保持合成层，材质与内容分别淡入；根节点始终保持完全不透明，避免动画结束时切换背景采样范围。减少动态效果时立即开合。

主弹层同样分离缩放、材质与内容淡入：150ms 入场、120ms 退场，保留原有位移、缩放幅度和缓动曲线。挂载期间不移除根节点 transform，不改变根节点 opacity；退场完成后卸载，并在过渡取消时兜底清理。快速重开延续当前过渡，减少动态效果时立即开合。

两种弹层的动画依赖固定版本 [MenuSurface 的材质子层结构](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-primitives/src/MenuSurface.tsx)：首个 `aria-hidden` 直接子元素是材质层。仅在 `.rong-model-popover` 和 `.rong-speed-menu` 内控制它的透明度，不改官方填充或 blur。升级时必须核对该结构和实际毛玻璃效果；禁止改回整个 MenuSurface 淡入，因为 [opacity 小于 1 会建立 Backdrop Root](https://drafts.csswg.org/filter-effects-2/#BackdropRoot)，导致结束时背景采样发生变化。

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
