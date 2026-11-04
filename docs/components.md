# 组件架构

`dsh-rong-aio` 是唯一安装、升级和卸载单位。根包将完整功能组合为 DSH 原生“包含的组件”；每个功能可独立启停，新功能默认开启。模型选择器、effort、Fast UI 与请求适配共同属于 `model-selector`，不拆成多个开关。

## 目录和边界

```text
src/
├── components/
│   └── model-selector/
│       ├── host/          # 速度持久化与请求适配
│       ├── client/        # 选择器、状态与样式
│       ├── shared/        # 本功能的纯类型、规则和运动计算
│       ├── locale/        # 原生组件名称与说明
│       └── package.json   # 独立客户端模块身份
├── runtime/host/          # 公共 Loader 装配
└── shared/                # 实际需要的跨组件纯契约与工具
```

Host 与 Client 不相互导入；Shared 不依赖任一侧、Node 或 DOM；Client 不使用 Node。组件可以使用自己的 Shared 和根 Shared，不能直接导入其他组件内部。确有协作需求时，通过公开服务契约连接。根 Shared 不引入组件实现；Runtime 不提供业务服务。

依赖、格式化、lint、类型、UI 契约、测试和构建由根包统一管理。内部清单不是 workspace 安装单位，不声明独立安装脚本或依赖；需要的库在根包固定版本，由构建内嵌或作为经过确认的宿主依赖外置。

## 运行入口

| 标识                          | 作用                                        |
| ----------------------------- | ------------------------------------------- |
| `dsh-rong-aio`                | 安装及 bundle 总开关；旧宿主入口兼容转发    |
| `rong-aio-model-selector`     | 稳定配置 ID，原生开关覆盖项的匹配依据       |
| `dsh-rong-aio/model-selector` | 原生功能条目、组件名称与说明的入口          |
| `dsh-rong-aio-model-selector` | 内部清单声明的唯一客户端工厂 ID，不单独安装 |

DSH rc.5 的客户端扫描不处理包子路径。根配置层因此只声明业务条目；该条目通过 `EntryTree` 创建 `implementation` 子条目，以文件 URL 加载 `lib/components/model-selector/index.js`。客户端扫描从附近的内部清单读取 `dsh.client` 和 `./client`，得到独立模块身份。

装配层使用 Cordis effect 管理异步加载和清理，即使加载途中停用，也会等待初始化结束后释放子条目。内部条目不写入根 bundle patch，因此原生“包含的组件”只显示业务功能。停用功能会同时清理 Fast 宿主服务、客户端插槽和样式；关闭总包停用全部组件。启停状态由 DSH profile 管理，插件不另行持久化。

`prepare` 统一生成 `lib/`，包括装配器、子路径入口、内部清单、locale、宿主和客户端产物。Zod、Zustand 和 Immer 随对应产物内嵌；Cordis、Loader、React 与 DSH 客户端模块使用宿主实例。安装方式和旧覆盖项调整见[安装说明](installation.md)。

## 新增组件

1. 在 `src/components/<功能名>/` 添加实际需要的 Host、Client 和 Shared；不要增加空业务模块。
2. 添加内部 `package.json`，名称为 `dsh-rong-aio-<功能名>`，使用 ESM，声明 `.` 指向 `./index.js`。有客户端时声明 `dsh.client` 和 `./client: ./client.js`，工厂 ID 由构建读取清单生成。纯 UI 组件可省略 `host/index.ts`，构建会生成宿主锚点。
3. 添加 `locale/en.json` 和 `locale/zh.json` 的 `meta.title`、`meta.description`，并在根 `exports` 声明 `./<功能名>` 与 `./<功能名>/locale/*.json`。宿主源码入口采用 `host/index.ts`，客户端采用 `client/index.ts`。
4. 在根 patch 加入稳定 `id` 和 `name: dsh-rong-aio/<功能名>`，不设置禁用。更新不能重用别的组件 ID，也不能重写用户已有覆盖项。
5. 补充适当的规则、交互和资源清理测试；执行 `pnpm check`、构建和安装包检查，在隔离 DSH 中验证单独启停、总包启停及重启后的覆盖状态。

UI 继续遵守 [DSH UI 消费契约](ui-contract.md)。目录迁移不能扩大装饰色例外或改变现有视觉、运动和键盘行为。
