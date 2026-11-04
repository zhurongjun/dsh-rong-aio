# dsh-rong-aio

自用的 DeepSeek Harness All-In-One 插件，以一个安装包承载后续功能。

当前是可安装的空 bundle，兼容基线为 **DSH `0.2.1-rc.5`**。启用后不注册工具、服务或界面，插件列表显示零个功能组件是正常状态。当前没有构建、CI、提交钩子或发布流程。

## 安装

安装到 DSH 无需先运行 `pnpm install`，也不需要编译。Desktop 和 Web 的安装、启停、卸载与更新方式见[安装说明](docs/installation.md)。

包只声明 `dsh.bundle.patch`，指向有效的空数组配置 `cordis.patch.yml`；没有待加载的代码入口。`private: true` 防止误发到 npm，不妨碍本地或 Git 安装。

## 目录

```text
src/
├── host/       # 宿主侧实现
├── client/     # 浏览器侧实现
└── shared/     # 两侧共用的类型、协议和纯函数
docs/
└── installation.md
```

每一侧以后按实际功能增加子目录，不提前创建工具、服务、钩子等空模块。Host 与 Client 通过 DSH 提供的通信机制协作，不直接导入彼此实现；两侧都可以导入 Shared。Shared 不依赖任何一侧，也不依赖 Node 或 DOM 专有能力。

目前没有路径别名，项目内部使用相对 ESM 导入。lint 对导入路径中的 `host`、`client` 目录段施加对应限制，也约束类型导入和转导出；这些名称用于运行侧边界。以后引入别名或改变目录组织时，必须同步更新并验证边界规则。

## 开发检查

开发工具使用 Node.js `^22.19.0 || >=24.0.0` 和 pnpm `11.25.0`。安装匹配版本的 pnpm 后，在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm check
```

| 命令                | 用途                                               |
| ------------------- | -------------------------------------------------- |
| `pnpm format`       | 使用 Prettier 格式化支持的源码、配置和文档         |
| `pnpm format:check` | 只检查格式，不改写文件                             |
| `pnpm lint`         | 使用 Oxlint 检查代码，任何警告或错误都会失败       |
| `pnpm lint:fix`     | 应用 Oxlint 支持的安全修复，剩余问题仍会使检查失败 |
| `pnpm check`        | 依次执行格式检查和 lint，不改写文件                |

格式统一为两空格、单引号、省略非必要分号、LF 换行和 100 列参考宽度。Markdown 保留手写段落换行。许可证和锁文件不经过格式化。

Oxlint 检查 JS/TS 正确性、未使用变量、调试语句与导入边界。Client、Shared 禁止导入 Node 内置模块；使用 ESM，禁止 `require()` 导入。目前没有 JS/TS 文件，lint 通过 `--no-error-on-unmatched-pattern` 允许零个源码文件；该参数不会忽略实际代码错误。不为通过检查添加空业务代码。lint 不替代类型检查和功能测试，这两项随首个实际功能接入。

## 本地文件与依赖

`pnpm-lock.yaml` 随项目提交，开发工具固定版本。真实环境配置、依赖、日志、缓存和 `.local/`、`.dsh-dev/` 下的本地数据不提交；`.env.example` 及 `.env.*.example` 可以提交，但只能包含示例值。

安装包的 `files` 白名单目前只包含空配置层和安装说明；包管理器同时包含 `package.json`、根 README 和许可证。添加首个功能时，需要同时更新运行入口、依赖、安装文件清单及验证步骤。

## 参考与许可证

- [DSH `0.2.1-rc.5` 插件安装指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/docs/user/develop/basic/publish.md)
- [DSH `0.2.1-rc.5` 配置层加载规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/boot/app-boot/README.md)
- [Oxlint 配置](https://oxc.rs/docs/guide/usage/linter/config)
- [Prettier 命令](https://prettier.io/docs/cli)

保留仓库已有的 [GPL v3 许可证](LICENSE)，包元数据使用 `GPL-3.0-only`。
