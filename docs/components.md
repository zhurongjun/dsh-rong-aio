# 组件架构

`dsh-rong-aio` 是唯一安装、升级和卸载单位。根包将完整功能组合为 DSH 原生“包含的组件”；每个功能可独立启停，新功能默认开启。模型选择器、effort、Fast UI 与请求适配共同属于 `model-selector`，不拆成多个开关。

## 目录和边界

`system-inject`（破甲模式）是独立组件，包含提示词库、会话显式选择与冻结快照、模型白名单和输入框提醒；见[使用说明](system-inject.md)。稳定 ID 为 `rong-aio-system-inject`，根导出为 `dsh-rong-aio/system-inject`，内部工厂为 `dsh-rong-aio-system-inject`。它直接接入 DSH 公共选模服务，不依赖模型选择器组件或客户端模型目录。

白名单新增菜单由 `system-inject` 自己实现，模型目录来自 DSH 公开的 `llm.listProviders/listModels`。它只维护授权，不调用 `selectModel` 或 Fast 服务；样式相似不构成代码、状态或运行依赖。两个组件各自管理客户端工厂、样式和生命周期，可以分别停用。

破甲组件负责保存前的选模校验与实际请求护栏。选模拒绝只返回给调用者，由各选模入口呈现：原生模型菜单和本包选择器使用官方 Toast，`/model` 保留 DSH 原生内联提示，不再通过破甲会话通知重复报告。选词与请求拒绝由破甲组件自身呈现 Toast。停用模型选择器后，原生选模仍受同一校验；停用破甲组件后释放校验。两个组件不识别对方错误码，也不共享通知状态。

```text
src/
├── components/
│   ├── model-selector/
│   │   ├── host/          # 速度持久化与请求适配
│   │   ├── client/        # 选择器、状态与样式
│   │   ├── shared/        # 本功能的纯类型、规则和运动计算
│   │   ├── locale/        # 原生组件名称与说明
│   │   └── package.json   # 独立客户端模块身份
│   └── system-inject/     # 同样按 host、client、shared、locale 和内部清单组织
└── runtime/host/          # 公共 Loader 装配
```

Host 与 Client 不相互导入；Shared 不依赖任一侧、Node 或 DOM；Client 不使用 Node。组件可以使用自己的 Shared 和根 Shared，不能直接导入其他组件内部。确有协作需求时，通过公开服务契约连接。根 Shared 只在实际需要跨组件纯契约时建立，不放占位文件；Runtime 不提供业务服务。

依赖、格式化、lint、类型、UI 契约、测试和构建由根包统一管理。内部清单不是 workspace 安装单位，不声明独立安装脚本或依赖；需要的库在根包固定版本，由构建内嵌或作为经过确认的宿主依赖外置。

## 运行入口

| 标识                          | 作用                                  |
| ----------------------------- | ------------------------------------- |
| `dsh-rong-aio`                | 安装及 bundle 总开关，无根运行入口    |
| `rong-aio-model-selector`     | 稳定配置 ID，原生开关覆盖项的匹配依据 |
| `dsh-rong-aio/model-selector` | 原生功能条目、组件名称与说明的入口    |
| `dsh-rong-aio-model-selector` | 模型选择器客户端工厂 ID，不单独安装   |
| `rong-aio-system-inject`      | 破甲模式稳定配置 ID                   |
| `dsh-rong-aio/system-inject`  | 破甲模式功能入口                      |
| `dsh-rong-aio-system-inject`  | 破甲模式客户端工厂 ID，不单独安装     |

DSH rc.5 的客户端扫描不处理包子路径。根配置层因此只声明业务条目；该条目通过 `EntryTree` 创建 `implementation` 子条目，以文件 URL 加载 `lib/components/<功能名>/index.js`。客户端扫描从附近的内部清单读取 `dsh.client` 和 `./client`，得到独立模块身份。

装配层使用 Cordis effect 管理异步加载和清理，即使加载途中停用，也会等待初始化结束后释放子条目。内部条目不写入根 bundle patch，因此原生“包含的组件”只显示业务功能。停用功能会同时清理其宿主服务、客户端插槽和样式；关闭总包停用全部组件。启停状态由 DSH profile 管理，插件不另行持久化。

`prepare` 统一生成 `lib/`，包括装配器、子路径入口、内部清单、locale、宿主和客户端产物。Zod、Zustand 和 Immer 随对应产物内嵌；Cordis、Loader、React 与 DSH 客户端模块使用宿主实例。安装方式见[安装说明](installation.md)。

## 新增组件

1. 在 `src/components/<功能名>/` 添加实际需要的 Host、Client 和 Shared；不要增加空业务模块。
2. 添加内部 `package.json`，名称为 `dsh-rong-aio-<功能名>`，使用 ESM，声明 `.` 指向 `./index.js`。有客户端时声明 `dsh.client` 和 `./client: ./client.js`，工厂 ID 由构建读取清单生成。纯 UI 组件可省略 `host/index.ts`，构建会生成宿主锚点。
3. 添加 `locale/en.json` 和 `locale/zh.json` 的 `meta.title`、`meta.description`，并在根 `exports` 声明 `./<功能名>` 与 `./<功能名>/locale/*.json`。宿主源码入口采用 `host/index.ts`，客户端采用 `client/index.ts`。
4. 在根 patch 加入稳定 `id` 和 `name: dsh-rong-aio/<功能名>`，不设置禁用。更新不能重用别的组件 ID，也不能重写用户已有覆盖项。
5. 补充适当的规则、交互和资源清理测试；执行 `pnpm check`、构建和安装包检查，在隔离 DSH 中验证单独启停、总包启停及重启后的覆盖状态。

UI 继续遵守 [DSH UI 消费契约](ui-contract.md)。维护时保持组件既定的视觉、运动和键盘行为。
