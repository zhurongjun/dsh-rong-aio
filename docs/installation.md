# 安装与维护

本项目目前是可安装的空 bundle，兼容基线为 **DeepSeek Harness `0.2.1-rc.5`**。安装、启用后不出现新工具或界面；插件显示零个组件是正常现象。

安装插件不需要执行仓库的 `pnpm install`，也不需要构建。仓库中的 Oxlint 和 Prettier 仅供开发检查，没有 `prepare`、`postinstall` 等安装生命周期脚本。

## 选择安装来源

| 来源         | 适用情形                           | 填写内容                                        |
| ------------ | ---------------------------------- | ----------------------------------------------- |
| 本地目录     | 在自己的工作区修改插件             | 含 `package.json` 的仓库根目录绝对路径          |
| Git 固定提交 | 在其他环境安装或固定一个已验证版本 | `github:zhurongjun/dsh-rong-aio#<完整提交 SHA>` |

Git 安装前，包含本次初始化文件的提交必须已推送到 GitHub；仅在本地创建文件不会改变远程安装结果。将 `<完整提交 SHA>` 替换为真实的 40 位提交值，不要连同尖括号一起使用。安装私有仓库时，所在机器的 Git 必须已具备该仓库的读取权限。

本地路径在 DSH 宿主所在机器上解析。连接远程 Web 实例时，应填写服务器上的路径，而不是浏览器所在电脑的路径。本地目录通常按链接安装，需要保留该目录；Git 安装使用对应提交的独立副本。

## Desktop 安装

1. 确认桌面版 DSH 版本为 `0.2.1-rc.5`。
2. 打开侧边栏的插件页面，选择“添加插件”（Add plugin）。
3. 填入仓库根目录的绝对路径，或上述固定提交的 Git 地址。
4. 核对来源，按界面要求确认信任并安装。
5. 安装完成后选择“立即启用”（Enable now）；若跳过，在已安装列表中打开 `dsh-rong-aio` 的开关。

当前工作区的本地路径是 `/Users/rong/workspace/project/dsh-rong-aio`。仓库移动后应使用新路径重新安装，不要继续依赖失效链接。

Desktop 的插件由桌面应用自己的 profile 管理。Web CLI 中的同名或默认 profile 不等于 Desktop profile；不要通过修改桌面应用安装目录或猜测内部配置路径来安装。

## Web 安装

以下命令中的 `dsh` 必须来自 `0.2.1-rc.5`。如果未安装全局命令，将每条命令开头的 `dsh` 替换为：

```sh
pnpm dlx @deepseek-ai/dsh@0.2.1-rc.5
```

### 使用已有 Web profile

确认当前 Web 实例使用的 profile。下面以 `web` 为例，本地安装时替换为实际的绝对路径：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-rong-aio
dsh --profile web --dump-config
dsh --profile web
```

Git 安装选择下面的命令，替换提交 SHA。对已经安装的包，先按下文卸载再重新安装：

```sh
dsh plugin --profile web add 'github:zhurongjun/dsh-rong-aio#<完整提交 SHA>'
```

CLI 安装新 bundle 通常会同时选中它；GUI 安装完成后提供单独的“立即启用”操作。以当前 profile 的插件列表状态为准。

### 使用独立测试环境

为了不影响日常会话，可在新终端为所有测试命令指定独立 home。以下为 macOS/Linux shell 示例：

```sh
export DSH_HOME="$(mktemp -d -t dsh-rong-aio.XXXXXX)"
dsh --profile rong-aio-dev --from-default-profile web --dump-config
dsh plugin --profile rong-aio-dev add /absolute/path/to/dsh-rong-aio
dsh --profile rong-aio-dev --dump-config
dsh --profile rong-aio-dev
```

`--from-default-profile web` 用于首次建立独立 Web profile；对已有同名 profile 重复使用会重置其模板配置。不要对日常 profile 执行该初始化命令。测试完成后先停止 DSH，再退出这个终端或执行 `unset DSH_HOME`；临时目录由你确认后清理。Windows 可在 PowerShell 中将 `$env:DSH_HOME` 设置为一个独立测试目录，再执行相同的 DSH 命令。

## 启停、重启和卸载

- **启用/停用**：在目标 Desktop 或 Web 实例的插件页面切换 `dsh-rong-aio`。停用保留安装副本，只移除选中的配置层。
- **重启**：重新打开同一个实例或用同一 `DSH_HOME`、同一 profile 启动。选中状态应保持。若 DSH 提示需要重启，以其提示为准。
- **Desktop 卸载**：在插件详情中执行卸载，不手动删除应用目录中的文件。
- **Web 卸载**：停止需要重启的实例后执行下方命令；也可以在该 Web 实例的插件页面卸载。

```sh
dsh plugin --profile web remove dsh-rong-aio
```

卸载不会删除你的源码仓库。不要直接删除整个 DSH home，它可能包含其他插件和会话。

## 更新与切换来源

Git 安装不会自动跟随本地修改。更新时记录当前提交 SHA 和启用状态，卸载旧包，用新的固定 SHA 重新安装，再恢复所需状态。回退也按相同步骤安装旧 SHA。

本地链接可以读取工作区文件，但变更是否即时生效由 DSH 的重载机制决定。更新包清单、配置层或将来的代码后，重启验证；移动目录或切换到 Git 来源时先卸载再安装。当前空 bundle 的外观不会因启停而新增界面内容。

## 排查

| 现象                                | 检查方式                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| 提示不是 bundle，或只安装为普通依赖 | 确认目录/提交中有正确的 `package.json`、`dsh.bundle.patch` 和 `cordis.patch.yml`  |
| 配置层解析失败                      | 空配置必须是 `[]`，不能是空文件或仅有注释；确认 YAML 文件已随安装内容保留         |
| 提示版本不兼容                      | 当前只声明支持 `0.2.1-rc.5`；不要通过兼容性豁免掩盖尚未验证的升级                 |
| Git 下载失败                        | 检查仓库权限、提交是否已经推送和 GitHub 连通性；切换 npm 镜像不能替代 GitHub 下载 |
| 本地目录找不到                      | 使用宿主机器上含包清单的绝对路径，并确认目录没有移动                              |
| 装完没有新功能                      | 当前就是空 bundle；检查插件条目和启用状态，不以新增按钮或工具判断安装是否成功     |
| Web 装完而 Desktop 看不到           | 两者管理各自的 profile，应在实际使用的实例中分别安装                              |

当前版本不要求执行安装脚本。如果 DSH 意外请求允许本插件的构建脚本，先核对安装来源、提交和包清单，不应把它当作本骨架的正常步骤。

## 官方依据

- [目标版本的打包与安装指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/docs/user/develop/basic/publish.md)
- [目标版本的配置层及兼容性规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/boot/app-boot/README.md)
- [目标版本的插件页面说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/client/ui-plugin-manager/README.md)
