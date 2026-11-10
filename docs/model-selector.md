# 模型与强度选择器

## 结构与数据

插件在 `conversation.input.model` 注册优先级 `-100` 的 UI，停用时由 DSH 自动清理插槽、样式和组件。保留官方 `ui-model-selection`，复用 `modelDirectories` 与 `session.selectModel`，因此模型入口和 `/model` 共享会话选择。只影响之后进入请求组装的步骤，不改变已经运行中的请求。

模型身份使用完整 provider/model；effort 只来自目录声明，速度支持按人工维护的模型 ID / 显示名允许列表判断。模型标签使用目录里的名称；没有接管原选择器私有的子标签插槽。普通被寻址子智能体不显示独立模型控件，遵循 DSH 原约束。

## 明确的 effort

- 只使用目录声明的档位和顺序，不插入 Default/auto。
- 切换模型和重置：优先选有效 `defaultEffort`，否则选 Medium，再选首个非 Off 档；只有 Off 时保留 Off，没有档位时不传 effort。
- 已有会话没有显式 effort 且目录未定义明确默认值时显示“请选择强度”，滑块不显示虚假的已选位置。
- 单一档位固定显示，无需拖动；无档位模型显示说明。
- 点击/方向键/Home/End 明确选择；拖动中预览，释放一次提交。取消手势或窗口失焦放弃预览。
- 圆钮已经经过的档位圆点隐藏，只保留右侧未经过的圆点；按实际动画位置更新，回退时恢复，不改变各档位的几何位置。
- 松手或键盘提交后保留待确认档位预览，保存中阻止重复提交；宿主确认后交接显示，失败只回退一次并展示错误。预览不改写共享目录中的已确认选择。

## Fast

左上角闪电标准时空心，快速/超快时实心。Fast 与 reset 始终为灰色，hover 只增加 26×26px、8px 圆角背景，不改变颜色、亮度、尺寸或 SVG 形状。支持时点击闪电打开速度菜单，仅保留档位名和选中勾，不显示灰色说明；不支持时禁用，不弹菜单。reset 仍只重置 effort。输入框的模型按钮在快速/超快时于模型名左侧显示实心闪电（随主题使用主文字颜色），标准档隐藏；窄输入框也保留该提示。速度状态由选择器持有，不依赖弹层是否打开；首次显示、切换会话和切换模型时读取对应持久化状态，旧请求不能覆盖新选择。

人工规则集中在 `src/components/model-selector/shared/speed.ts`，核对日期 **2026-11-04**。匹配模型 ID 或 DSH 目录中的显示名，统一大小写、空格、小数点和连字符，允许日期版本后缀；其他后缀与未知型号不启用。界面和宿主共享规则，客户端不能通过传入显示名绕过宿主验证。

| 型号                                              | 可选速度           | 请求字段                                                |
| ------------------------------------------------- | ------------------ | ------------------------------------------------------- |
| GPT-6 Astra、GPT-6.1 Sol                          | 标准 / 快速 / 超快 | `service_tier: default / fast / ultrafast`              |
| GPT-5.6 Sol、GPT-6 Sol、GPT-6.1 Terra、GPT-6 Luna | 标准 / 快速        | `service_tier: default / fast`                          |
| Claude Opus 5.5                                   | 标准 / 快速        | `speed: standard / fast`                                |
| Claude Opus 5、Claude Opus 4.8                    | 标准 / 快速        | 同上；快速时合并 `anthropic-beta: fast-mode-2026-02-01` |

OpenAI Fast 参数及支持范围参见[官方 Fast 文档](https://developers.openai.com/api/docs/guides/fast-mode)，Ultrafast 型号参见[官方 Ultrafast 文档](https://developers.openai.com/api/docs/guides/ultrafast-mode)。Claude 规则参见[官方 Fast 文档](https://platform.claude.com/docs/en/build-with-claude/fast-mode)：Opus 4.6 接受参数但不会真正加速，因此不启用；Opus 4.8 Fast 将于 2026-11-30 停用，届时需要移除对应规则。

速度状态按 **profile + sessionId + provider + model** 隔离，使用 DSH 公开 `storageDomain` 的 `rong_aio_speed` 域持久化；写入成功后才改变 UI，失败显示错误并保留原值。重开弹层重新读取状态，不使用浏览器本地缓存冒充服务器状态。切换模型保留各自选择，Desktop / Web profile 独立。界面表示请求的档位；网关转发、账户权限、配额和上游实际服务速度由提供商决定，快速档可能产生更高费用。

rc.5 的 GenerateOptions / pi-ai 调用不透传任意 payload 字段，因此宿主在公开 `llm/stream` 作用域内，用 AsyncLocalStorage 对 fetch 做限定兼容：仅修改当前模型的 POST `/responses`、`/chat/completions` 或 `/messages` JSON，保留消息、原有请求头和取消信号。标准档明确发送标准值；标题生成、压缩、无会话请求不继承速度。并发请求各自隔离，插件停用时恢复 fetch。

Ultrafast 暂仅对 Responses 连接开放，依据[官方 FAQ](https://help.openai.com/en/articles/11647665-fast-mode-faq)；Completions 连接只提供标准/快速。OpenAI 请求会移除可能与所选档位冲突的可选 `OpenAI-Service-Tier` 头，由请求体明确指定速度。

通过公开 settings 描述检查连接协议，目前支持 `openai-responses`、`openai-completions`、`anthropic-messages` 的 HTTP 请求。Codex OAuth、WebSocket 专用协议、Bedrock、Vertex 及其他未经验证的协议保持禁用。兼容层不修改应用安装文件或私有适配器对象；DSH 升级后必须重新验证该请求边界。停用插件后不再注入速度字段，重新启用可恢复已保存的选择。

## 交互与动画

选模、推理强度或 Fast 保存失败使用 DSH 官方 Toast，不在菜单内重复显示操作错误，也不创建拒绝 Modal。当前模型与强度保留宿主已接受的结果。Toast 不抢占焦点；模型目录读取失败仍在菜单内提供重新加载入口。

打开是紧凑滑块；点击居中标题进入同一弹层的分组模型列表，默认聚焦顶部的紧凑搜索框，可直接输入。搜索支持模型名、模型 ID、提供商名及 ID 的多词匹配。列表方向键移动，Enter 选择；Esc 返回/关闭，Tab 在弹层可交互控件间移动。弹层跟随锚点，限制在视口内，窄输入框遵循 DSH 的图标折叠变量。

Fast 菜单只展示档位名称和固定宽度的勾选列，最小宽 96px、行高 30px，采用官方 compact 菜单表面。入场 160ms、退场 110ms，以靠近闪电的位置为缩放原点，快速开合可从当前帧反向；退场期间不再响应选项，结束后卸载，动画不随系统减少动态效果配置改变。

动画独立于请求耗时：入场 150ms、退出 120ms，列表与滑块的高度切换 180ms。滑块采用 requestAnimationFrame 连续位置/速度跟踪，跨档阈值、速度上限和过冲钳制集中在 `src/components/model-selector/shared/slider-motion.ts`。滑轨填充使用 DSH 的 DeepSeek 蓝色主题变量 `--dsw-alias-state-business-primary`，不显示渐变或滚动扫光；粒子密度随滑块位置增加。弹层、滑块和粒子始终使用本插件的运动参数，不受系统减少动态效果配置影响。卸载清理动画帧、事件监听及 ResizeObserver。

面板采用 Codex 紧凑布局：面板宽 256px、高 98px，水平内距 13px；标题 14/20px、模型名 12/18px；滑轨 24px，圆钮 28px。Fast 和重置均为 16px SVG，采用归一化的轮廓；闪电关闭时空心、开启时实心，重置为细描边。强度标题为蓝色，模型名右侧放箭头；模型名保持居中。文字、中性图标、轨道、焦点与强调色消费 DSH 语义 token；MenuSurface 采用官方材质、16px 圆角及平台轮廓，明暗主题由宿主管理，详见 [UI 消费契约](ui-contract.md)。主面板与 Fast 的缩放、材质和内容淡入分别处理；挂载期间保留根节点合成层，避免收尾时改变背景采样或切换图层，具体结构约束见 UI 消费契约。

粒子与滑块计算固定参考 `Microqian2th/dsh-codex-effort-slider` 提交 `fc5a994e34d3329bef748135e2c2ed219b9e30ce`，按其代码改编并保留 MIT 许可。粒子保持固定高度，**从右向左连续横穿**，无往复或上下浮动。

| 参数              | 固定上游值                                                   |
| ----------------- | ------------------------------------------------------------ |
| 粒子数            | `round(energy × 22)`，energy 从轨道 1/3 处开始线性增长       |
| 速度因子          | `clamp(3 × position − 1, 0.35, 2)`                           |
| 单次横穿          | `1.5 × 2 / speed × (1 ± 0.08)` 秒                            |
| 粒子大小          | 3px × 亮度系数；亮度在 0.5–1 之间                            |
| 高度/相位         | 8%–92% 的确定性排列，黄金比相位，负延迟错峰                  |
| 淡入淡出          | 横穿的 0%–6% 淡入，94%–100% 淡出；中间保持可见               |
| 运动参数          | `K=60, A=500, k=60, amax=300, vmax=10, epsX=.0015, epsV=.02` |
| 松手外推 / 帧上限 | `0` / `0.05s`                                                |

本项目使用静态淡蓝填充，不显示能量渐变和扫光，并隐藏已经过的档位圆点；粒子与运动计算沿用固定上游参数。粒子动画不受系统减少动态效果配置影响。

## 代码职责

- `shared/model-selection.ts` 处理模型与明确 effort，`shared/speed.ts` 维护速度规则；运动和粒子数学计算分别集中在 `slider-motion.ts`、`particle-motion.ts`。改编来源与许可见 [第三方声明](../THIRD_PARTY_NOTICES.md)。
- `ModelSelector.tsx` 只组合控制器和子视图，管理菜单定位、焦点、退场与键盘导航；`useModelSelection.ts` 只读订阅宿主目录并协调模型、effort、Reset 的串行提交。DSH `modelDirectories` 是已确认模型的唯一来源。
- `selector-store.ts` 管理每个会话的弹层、搜索、手势预览、进行中操作和 Toast。操作具有序号、种类和路由；只有对应序号可释放操作，不复制宿主模型目录。`speed-store.ts` 按会话/provider/model 路由独立读取和保存速度，迟到响应不能覆盖新路由。
- `EffortPanel.tsx` 组合 Fast、标题、Reset 和受控滑杆；`useEffortPreview.ts` 为面板和输入框入口提供同一档位投影。`EffortSlider.tsx` 只持有手势与运动资源，不另存待确认档位或保存请求。
- `SelectionButton.tsx` 统一鼠标、键盘激活保护。能力缺失或会话锁定使用原生 `disabled`；短暂请求等待使用 `aria-disabled`/`aria-busy` 并拦截激活，保留颜色、形状、hover 背景和焦点。Escape、Tab 仍由外层处理。
- React 负责结构与可访问性；`useSliderMotion.ts` 的 RAF 只更新运动样式、粒子节点和经过状态，不逐帧更新 React store。同一运动属性不能同时由 JSX 写入。
- `host/index.ts` 装配速度接口、storageDomain 和 `llm/stream`；`host/speed-transport.ts` 在限定请求作用域内适配 HTTP 字段，停用恢复 fetch。

## 状态依赖与刷新

| 状态来源                           | 影响范围                                                        | 不产生的副作用                                    |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| 宿主 `current` 与模型目录          | 模型名、明确档位目录、Reset 默认档；模型身份变化后重新读取 Fast | 不使用宿主 `pending` 冒充已确认模型               |
| 手势预览、进行中 effort/Reset 操作 | 滑杆目标、标题、输入框 effort；操作按模型及档位目录隔离         | 不改写宿主 `current`，不刷新 Fast，不重挂载工具栏 |
| 本实例选模操作、宿主 `pending`     | 暂时阻止模型、effort、Reset 和 Fast 操作                        | 不将正常按钮置灰，不改变已确认速度或 SVG 轮廓     |
| Fast 能力、最近确认速度            | Fast 是否真正可用、空心/实心图标、速度菜单勾选                  | 不依赖 effort 预览或档位值                        |
| Fast GET/PUT 状态                  | 只阻止 Fast 自身操作，保留最近确认显示                          | 不禁用 Reset，不改写模型或 effort                 |
| 搜索、列表高亮、粒子运动           | 各自视图；粒子帧直接写动画 DOM                                  | 不触发宿主选模和速度请求                          |

档位展示优先级为：**同路由待确认操作 → 同路由手势预览 → 宿主确认值**。拖动只写手势预览；松手、键盘和 Reset 由控制器原子取得操作资格并接管预览。成功后交接给宿主确认值，失败后回退并显示一次 Toast。关闭只丢弃未提交手势；进行中操作在面板重新挂载后仍可投影。会话更换建立新实例，旧实例的完成或拒绝不写入新实例。

打开菜单时加载模型目录；保存期间重开复用目录，避免额外加载改写拒绝结果的归属。Fast 在首次挂载、已确认模型身份变化和菜单重开时读取；更换路由中止旧请求，同路由刷新保留已确认速度。仅修改 effort、拖动、搜索和 RAF 运动都不重新读取 Fast。
