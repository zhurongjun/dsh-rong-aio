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
- 保存中阻止重复提交；失败展示错误并恢复共享目录中的真实选择。

## Fast

左上角闪电标准时空心，快速/超快时实心。Fast 与 reset 始终为灰色，hover 只增加 26×26px、8px 圆角背景，不改变颜色、亮度、尺寸或 SVG 形状。支持时点击闪电打开速度菜单，仅保留档位名和选中勾，不显示灰色说明；不支持时禁用，不弹菜单。reset 仍只重置 effort。输入框的模型按钮在快速/超快时于模型名左侧显示实心闪电（随主题使用主文字颜色），标准档隐藏；窄输入框也保留该提示。速度状态由选择器持有，不依赖弹层是否打开；首次显示、切换会话和切换模型时读取对应持久化状态，旧请求不能覆盖新选择。

人工规则集中在 `src/shared/speed.ts`，核对日期 **2026-11-04**。匹配模型 ID 或 DSH 目录中的显示名，统一大小写、空格、小数点和连字符，允许日期版本后缀；其他后缀与未知型号不启用。界面和宿主共享规则，客户端不能通过传入显示名绕过宿主验证。

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

打开是紧凑滑块；点击居中标题进入同一弹层的分组模型列表，默认聚焦顶部的紧凑搜索框，可直接输入。搜索支持模型名、模型 ID、提供商名及 ID 的多词匹配。列表方向键移动，Enter 选择；Esc 返回/关闭，Tab 在弹层可交互控件间移动。弹层跟随锚点，限制在视口内，窄输入框遵循 DSH 的图标折叠变量。

Fast 菜单只展示档位名称和固定宽度的勾选列，最小宽 96px、行高 30px，采用官方 compact 菜单表面。入场 160ms、退场 110ms，以靠近闪电的位置为缩放原点，快速开合可从当前帧反向；退场期间不再响应选项，结束后卸载，减少动态效果时直接开合。

动画独立于请求耗时：入场 150ms、退出 120ms，列表与滑块的高度切换 180ms。滑块采用 requestAnimationFrame 连续位置/速度跟踪，跨档阈值、速度上限和过冲钳制集中在 `src/shared/slider-motion.ts`。滑轨填充使用 DSH 的 DeepSeek 蓝色主题变量 `--dsw-alias-state-business-primary`，不显示渐变或滚动扫光；粒子密度随滑块位置增加。减少动态效果时去掉弹层与粒子动画，滑块直接到位。卸载清理动画帧、事件监听及 ResizeObserver。

面板采用 Codex 紧凑布局：面板宽 256px、高 98px，水平内距 13px；标题 14/20px、模型名 12/18px；滑轨 24px，圆钮 28px。Fast 和重置均为 16px SVG，采用归一化的轮廓；闪电关闭时空心、开启时实心，重置为细描边。强度标题为蓝色，模型名右侧放箭头；模型名保持居中。图标不是 Codex 原始 SVG 源文件。文字、中性图标、轨道、焦点与强调色消费 DSH 语义 token；MenuSurface 采用官方材质、16px 圆角及平台轮廓，明暗主题由宿主管理，详见 [UI 消费契约](ui-contract.md)。主面板入场不保留动画填充；Fast 的缩放与材质、内容淡入分别处理，避免根节点透明度在收尾时改变背景采样，具体结构约束见 UI 消费契约。

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

本项目使用静态淡蓝填充，不显示能量渐变和扫光，并隐藏已经过的档位圆点；粒子与运动计算沿用固定上游参数。减少动态效果时停用粒子动画。弹层 150/120/180ms 的开合参数是当前实现值，没有证据证明它们是 Codex 官方原值。

## 参考与复刻范围

- [Codex 紧凑选择器公开截图](https://codex-design.beacon.host/audit/crops/effort-popover.png?v=1789018609023)
- [公开视频的 18:23](https://www.youtube.com/watch?v=i33yG_W9-1U&t=1103s)
- [Microqian2th 的运动研究与演示](https://github.com/Microqian2th/dsh-codex-effort-slider)
- [HanaAyane 的 DSH 公共插槽集成参考](https://github.com/HanaAyane/dsh-reasoning-effort)

布局参考 Codex 选择器。运动与粒子模块改编自上述 MIT 项目，许可见 `THIRD_PARTY_NOTICES.md`。该项目没有提供可独立验证的“百分之百一致”证明；公开研究不等于官方动画常量，因此不声称像素或时序完全一致。
