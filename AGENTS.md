# 项目协作约定

## 当前范围

- 本项目是自用、一个安装入口包含多个功能组件的 DSH 插件，用户只安装 `dsh-rong-aio`。当前模型选择器、effort、Fast UI 与宿主请求适配是同一个组件，验证基线为 `0.2.1-rc.5`。
- 文档使用中文。维护选择器、构建和测试，不自行扩展新业务、CI 或发布流程。
- 保留现有 LICENSE 原文；开发依赖固定版本并更新 pnpm-lock.yaml。

## Agent 工作文件（强制）

- 仓库根目录的 `agent_temp/` 是 Agent 工作过程文件的唯一存放位置；按需创建子目录，该目录整体被 Git、格式化和 lint 忽略。全新检出没有此目录时，使用前自行创建，不添加占位文件到版本控制。
- QA 文档、验收报告、视觉对照、截图/录屏、工作日志、调研摘录、计划草稿、一次性验证脚本、临时配置、调试数据、隔离运行环境、源码副本、测试生成代码和临时安装包，一律放入 `agent_temp/`。正式工程中禁止出现这些过程性文件，包括根目录及 `docs/`、`src/`、`scripts/`、`tests/`；不得以 `design-qa.md`、`qa-report.md` 等名称保留，也不得换名后混入正式文档。
- 正式工程只保留产品源码、必要配置、可复用构建脚本、长期维护的自动化测试及其必需 fixture、使用说明和架构/接口约定。正式文档只描述当前产品与维护契约，不写本轮执行经过、截图记录或验收结果；不得链接或依赖某次工作产生的临时文件。
- `agent_temp/` 不得加入包的 `files` 白名单、运行时入口或安装依赖，禁止通过 `git add -f` 提交。测试可以在运行时创建其输出子目录，但不得依赖其中预先存在的文件；正式源码、测试和构建必须能从干净检出运行。
- 打包输出使用 `pnpm pack --pack-destination agent_temp/packages`；独立 DSH home、日志及临时工作树/副本也放入该目录。pnpm 的项目缓存由 `pnpm-workspace.yaml` 定向到 `agent_temp/pnpm-store`；`node_modules/` 和安装契约规定的 `lib/` 保持工具及运行入口的固定位置，并继续忽略。
- 如工具必须先生成文件到系统临时目录，应在该次操作结束后立即迁入 `agent_temp/`。不得移动用户提供的原始附件或无关文件。
- 收尾时检查 Git 状态与安装包内容，确认没有过程性文件进入正式工程或安装包；已散落的工作文件应迁入 `agent_temp/`，同时移除正式文档及包清单中的引用。

## 代码边界

- `src/components/<功能>/host`：宿主侧实现，可使用 Node 能力，可依赖 Shared，不导入 Client。
- `src/components/<功能>/client`：浏览器侧实现，可依赖 Shared，不导入 Host 或 Node 内置模块。
- `src/components/<功能>/shared`：组件内部的纯类型、协议和函数，不依赖 Host、Client、Node 或 DOM 专有能力。
- `src/runtime/host` 只负责组件装配，不放业务逻辑；根部 `src/shared` 只放已被多个组件需要的公共契约与纯工具，不提前抽象或移动单组件规则。
- 组件不直接导入其他组件内部，也不依赖装配层；跨组件协作通过根 Shared 中的公开契约和 DSH 服务完成。`pnpm lint` 包含静态边界检查，覆盖 import、再导出、类型导入和固定路径动态导入。
- 功能确定后才增加目录；项目内部使用相对 ESM 导入。引入路径别名或调整目录时同步验证 lint 边界。
- Fast 型号规则集中在 `src/components/model-selector/shared/speed.ts`；宿主按会话、provider、model 隔离状态，只改写已验证 HTTP 协议的速度字段，不修改消息内容。
- DSH 扩展优先依赖公开服务契约，注册资源遵循其生命周期清理机制。

## 组件接入约定

- 每个完整功能对应一个稳定配置 ID、一个根包子路径入口及一个内部包清单；参考 [组件架构](docs/components.md)。内部清单只提供模块身份，不单独安装或发布，不增加独立锁文件、工具链或 workspace 依赖。
- 新组件在 `cordis.patch.yml` 中默认启用，不写 `disabled: true`；已有 ID 不随目录或名称变动，用户关闭状态由 DSH profile 覆盖层保留。不得另建启停数据库、批量重置覆盖项或增加 AIO 管理页面。
- 新增组件时同时更新清单、根包 exports、中文/英文 locale 元信息和配置层。统一构建发现 `src/components/*/package.json`，生成独立客户端工厂与宿主装配入口；所有内部清单和产物随根包分发。
- rc.5 不扫描包子路径客户端；必须由公开 Loader 挂载带独立清单的内部条目。内部条目不写入根配置层，随所属功能卸载，不能泄漏客户端、样式、事件或宿主资源。
- Cordis 和 Loader 作为宿主提供的可选 peer 声明并外置，开发/测试使用固定版本；不要内嵌框架副本。纯 UI 组件由构建生成空宿主锚点，不增加业务占位模块。
- 组件新增或装配变更必须验证独立启停、总包启停、重新加载和清理；临时双组件夹具放在 `agent_temp/`。保留旧宿主入口的兼容转发、选择器 ID、Fast 接口和存储名称；手写绑定旧模块名的覆盖项需在安装说明中明确迁移方式。

## 安装契约

- `cordis.patch.yml` 必须是有效 YAML 数组，通过 insert 注册实际存在的插件入口。
- 不声明不存在的 `main`、`types` 或代码导出。
- 改动安装入口、文件白名单或运行依赖时，验证从干净检出安装，不能依赖工作区残留文件。
- 安装验证优先使用隔离的 DSH home/profile；用户明确要求时可通过官方插件页面安装到日常 Desktop，避免改变已有会话的模型配置。不得修改应用安装目录。
- `prepare` 生命周期调用独立构建脚本，在源码 `pnpm install`、Git 依赖准备和 `pnpm pack` 时生成 `lib/`；`lib/` 不提交。构建不依赖工作区外文件，不在生命周期中执行检查、修改宿主配置或安装全局工具。
- Git 安装须验证固定提交与 DSH profile 的精确构建许可；不得自动放开全部依赖脚本。安装包包含产物，作为依赖安装时不重新构建、不需要开发依赖。显式禁用生命周期时需手动 `pnpm build`。

## Design Token 与界面规范（强制）

- 以 DSH `0.2.1-rc.5` 为基线，遵守 [UI 消费契约](docs/ui-contract.md) 与 `scripts/ui-contract.json`。直接使用宿主提供的语义 CSS 变量和 `@deepseek-ai/dsh-client-ui-primitives` 公开组件；不复制全量 token、主题 CSS 或组件库，不建立重复的主题状态管理或逐项转发层。
- 中性文字、图标、背景、边框、hover、focus、disabled 和强调色必须使用官方语义 token，不用相近 hex 猜测，不直接消费原始色板，不自行写 `light-dark()`、系统明暗媒体查询或宿主明暗属性分支。DeepSeek 蓝使用 `--dsw-alias-state-business-primary`；`brand-primary` 是中性色。
- 菜单使用 `MenuSurface`，由官方管理填充、模糊、圆角与平台 backing；不得覆盖 `--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter` 或主题圆角。其他宿主命名空间变量默认只读，仅允许消费契约中精确登记的局部 elevation/scrollbar 重绑。
- 普通控件优先使用官方 public export；先核对布局密度、可访问性、键盘和生命周期语义再替换。统一样式不等于改成官方模型选择流程；保留当前单层入口、明确 effort、Fast、SVG、滑杆几何、向左运动粒子、已过圆点隐藏与 reduced-motion。
- 字体继承宿主字体偏好；字号、行高、字重等值时才映射官方排版角色。组件几何、14/20/600 标题和特色运动可保留局部数值，不为消除字面量误用 token。Fast/Reset hover 只改变背景，不改变图标颜色、亮度或形状。
- 新增 token 必须核对固定版本官方声明与语义，并更新消费清单的来源。装饰色例外需登记文件、选择器、属性、完整值与原因；不得使用整文件豁免，也不得把例外扩展到中性控件。
- 运行 `pnpm check:ui` 验证 CSS AST 与 TSX/SVG 静态样式；动态颜色写入 CSS 语义类，不能用字符串注入绕过检查。检查器不代替实际主题、字体、窄视口、键盘与平台材质验证。
- DSH 升级时复核 token、public export 和菜单材质；日常检查离线运行，不自动跟随 upstream main。研究快照、完整 token 抽取、截图和验证记录只能放在 `agent_temp/`。

## 检查

- 完成修改前运行 `pnpm check`（格式、lint、UI 契约、类型、测试）及 `pnpm build`；check 不改写源码，测试生成文件只写入忽略的 `agent_temp/`。
- 需要修复时显式运行 `pnpm format`、`pnpm lint:fix`，随后重新检查。
- 质量配置变更用临时正反例验证，包括合法 Shared 导入、跨侧导入、Node 内置模块、未使用变量及调试语句；不提交这些临时样例。
- 不通过全局关闭规则或吞掉退出码掩盖失败；必要的局部例外应说明原因。
- 不自行提交、推送或创建发布。
