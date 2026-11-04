# 安装与维护

兼容基线为 **DeepSeek Harness `0.2.1-rc.5`**。Desktop 与 Web 使用各自的 profile，安装来源、构建许可和启用状态分别管理。

## Git 安装入口

推荐使用固定提交：

```text
github:zhurongjun/dsh-rong-aio#<完整提交 SHA>
```

将 `<完整提交 SHA>` 替换为已推送到仓库的 40 位提交号。省略 `#...` 可安装默认分支最新版本，但更新和回退建议固定提交。HTTPS 形式也可使用：

```text
git+https://github.com/zhurongjun/dsh-rong-aio.git#<完整提交 SHA>
```

Git 安装下载源码，由 pnpm 在临时目录安装开发依赖并运行 `prepare`，生成 `lib/` 下的组件入口、内部清单、locale、宿主代码及客户端工厂，再按文件白名单安装。无需手动 clone 或 build；源码不依赖工作区外文件，`lib/` 不提交。初次安装需要联网获取源码和构建依赖；开发依赖不进入最终插件运行包。

Git 构建的宿主环境需能直接执行 Git、Node.js `^22.19.0 || >=24.0.0` 和 pnpm `11.25.0`。DSH 内置的包管理器并不保证它启动的子进程也能在 PATH 找到 `pnpm`。已有 Node.js 时可安装固定版本：

```sh
npm install --global pnpm@11.25.0
node --version
pnpm --version
```

macOS Desktop 会在启动时读取登录 shell 的环境；若安装工具或修改 PATH 后仍找不到命令，退出并重新打开 DSH。插件自身的生命周期只构建源码，不安装全局工具。不具备构建环境的机器可以使用下文的安装包方式。

## Desktop

1. 若已安装本插件的本地目录或旧版本，先在“插件 → dsh-rong-aio”详情中卸载；同名包不能重复添加。
2. 点击“添加插件”，填入上面的 Git spec，将提交占位符替换为实际值，点击“安装”。
3. 首次安装可能被 pnpm 的构建许可拦下。展开“查看安装详情”，核对请求运行的是本插件的构建脚本；若提供“允许这些脚本并重试”，确认列表只包含本次需要的包后使用该按钮。
4. 安装完成后点击“立即启用”。按界面提示重新加载或重启；重新打开会话，模型按钮应直接显示强度滑块，顶部标题可进入模型搜索。

若 Git 构建错误未被界面识别为可批准的包，关闭弹窗，按 pnpm 错误输出将**完整且精确的键**加入当前 Desktop profile 的 `pnpm-workspace.yaml` 中已有的 `allowBuilds` 映射，再重试同一个 spec。默认文件位置为 `$DSH_HOME/profiles/desktop/pnpm-workspace.yaml`，未设置 `DSH_HOME` 时为 `~/.dsh/profiles/desktop/pnpm-workspace.yaml`。保留该文件其他配置；不设置全局忽略限制或允许全部脚本，不用 CLI 绕过 Desktop 的 profile 管理。

构建许可允许包以宿主用户权限运行构建代码，只批准信任的源码。Git 来源的键可能包含 URL 和提交号，必须以当前 pnpm 输出为准；升级到另一个提交可能需要再次许可。仓库内对 esbuild 的开发构建许可不代替 DSH profile 对本插件的许可。

## Web

以下命令中的 `dsh` 必须来自 `0.2.1-rc.5`。没有全局命令时，将 `dsh` 替换为 `pnpm dlx @deepseek-ai/dsh@0.2.1-rc.5`。

```sh
dsh plugin --profile web add 'github:zhurongjun/dsh-rong-aio#<完整提交 SHA>'
```

首次因构建许可失败时，将 pnpm 输出的精确键添加到 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds`，保留其他配置，再执行同一个 add。结构示意如下，键本身必须替换为实际输出：

```yaml
allowBuilds:
  '<pnpm 输出的完整包键>': true
```

成功后验证配置并启动：

```sh
dsh --profile web --dump-config
dsh --profile web
```

配置应包含 `id: rong-aio-model-selector`、`name: dsh-rong-aio/model-selector`。已有实例需要重新加载或重启。Git 安装发生在 DSH 宿主机器，宿主需要访问 GitHub 和依赖注册表；切换 npm 镜像不能修复 GitHub 连接问题。

## 本地源码开发

使用 Node.js `^22.19.0 || >=24.0.0`、pnpm `11.25.0`：

```sh
git clone https://github.com/zhurongjun/dsh-rong-aio.git
cd dsh-rong-aio
git checkout <完整提交 SHA>
pnpm install --frozen-lockfile
pnpm check
```

`pnpm install` 的 `prepare` 自动构建。若显式使用 `--ignore-scripts`，安装结束后需手动 `pnpm build`；不能把未生成 `lib/` 的目录交给 DSH。之后在 Desktop 添加仓库绝对路径，或在 Web 执行：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-rong-aio
```

本地目录通常通过链接安装，DSH 不替链接目标运行 prepare，需保留源码目录。移动仓库后先卸载，再从新路径安装。开发中修改源码后执行 `pnpm check && pnpm build`，再重新加载 DSH。

## 安装包

在安装过开发依赖的源码目录执行：

```sh
pnpm pack --pack-destination agent_temp/packages
```

`pnpm pack` 通过同一个 `prepare` 自动构建，避免旧产物被直接打包。将生成的包传到目标机器后安装：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-rong-aio-0.1.0.tgz
```

Desktop 可在“添加插件”中填写本地包绝对路径。安装包只包含运行产物、配置层和必要说明，作为依赖安装时不运行构建，不需要开发依赖；支持在 Git 构建环境不可用时安装预先生成的包。

## 启停、卸载、更新和回退

- **整个插件启停**：在插件页面切换 `dsh-rong-aio` 总开关，控制全部功能组件。
- **单个功能启停**：进入详情的“包含的组件”，切换“模型选择器”。这会同时停用或启用选择器、effort、Fast UI 和请求适配；停用后官方选择器恢复。官方模型目录插件须保持启用。
- **状态沿用**：新组件默认开启；已有组件通过稳定 ID 保留当前 profile 的关闭覆盖，重启或总包重新启用不应重置。Desktop 与 Web 分别管理。
- **Desktop 卸载**：进入本插件详情并选择“卸载”，按提示重载或重启，已安装列表中应不再出现本插件。
- **Web 卸载**：`dsh plugin --profile web remove dsh-rong-aio`，然后重启已有实例。
- **Git 更新、重新安装或回退**：记录当前安装的提交及启用状态，卸载后安装目标提交的 spec，再启用。已安装副本不会随远程 push 或开发目录改动自动更新。
- **安装包更新或回退**：卸载后安装目标版本的包，再启用。
- **构建许可**：卸载可能保留当前 profile 的 `allowBuilds` 记录；不再信任某来源时可移除对应精确键，不影响其他包。

插件卸载不应作为清除会话或速度设置的方法。Fast 状态保存在当前 profile 的 storageDomain 中，停用即停止请求参数注入；重新安装并启用后沿用持久化设置。

## 从单功能入口升级

安装单位仍为 `dsh-rong-aio`，不需要分别安装内部组件。模型选择器配置 ID 仍是 `rong-aio-model-selector`，模块名称改为 `dsh-rong-aio/model-selector`；旧宿主入口 `dsh-rong-aio` 仍兼容转发。Fast 接口 `/api/rong-aio.speed` 与存储域 `rong_aio_speed` 的名称和版本保持不变。

通过原生开关写入的覆盖项通常只有 ID，可直接沿用。如果手写覆盖项同时绑定旧名称，请只将该条目的 `name` 更新为 `dsh-rong-aio/model-selector`，或者移除 `name` 仅按稳定 ID 匹配；保留 `disabled` 及其他设置。例如：

```yaml
- id: rong-aio-model-selector
  disabled: true
```

不要另外新增 `name: dsh-rong-aio` 的插件实例；这会与组合包内的同一组件重复。安装器不自动改写用户覆盖文件。更新包后按宿主提示重启，确认“包含的组件”显示中文名称，且既有关闭状态仍然保留。

## 排查

| 现象                                       | 检查                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 构建脚本被拦截                             | 核对错误中的包键，仅在目标 profile 允许对应 Git 构建后重试                                   |
| `pnpm: command not found` / `spawn ENOENT` | 在 DSH 宿主安装固定 pnpm 并确保登录 shell 的 PATH 可见，再重启 DSH；此时还未进入插件 prepare |
| 找不到 `lib/` 中的入口或组件产物           | 检查 prepare 是否成功、是否禁止脚本；本地链接先执行 `pnpm build`                             |
| Git 安装失败                               | 提交须已推送；宿主能访问 GitHub 和注册表，且 Node/pnpm 版本兼容                              |
| 同名插件已安装                             | 先卸载当前来源，再安装新的 Git spec、路径或安装包                                            |
| 仍显示原生双层菜单                         | 确认当前 profile 已启用并重新加载；检查模型插槽是否被其他插件占用                            |
| 没有推理档位                               | 当前 provider/model 未通过 DSH 目录声明档位；在 DSH 模型配置中核实                           |
| Fast 灰色                                  | 检查型号允许列表、连接协议与宿主速度接口；未支持的组合保持禁用                               |
| 保存失败                                   | 检查会话锁、连接与模型路由，再重试；界面会回退原值                                           |
| 模型目录加载失败                           | 点击“重新加载”，检查 DSH 提供商设置                                                          |
| 版本不兼容                                 | 当前只验证 rc.5，不启用兼容豁免                                                              |

宿主入口提供速度设置持久化与请求参数适配；浏览器代码通过 DSH `__ModuleLoader__` 模块工厂加载，每个内部组件使用自己的模块身份；React、UI primitives、Cordis 与 Loader 由 DSH 提供。修改宿主代码、包清单或配置层后需重启 DSH，仅刷新 Web 页面不会重新载入宿主模块。Zod 随宿主产物打包。

## 官方依据

- [目标版本的 Git 安装与 prepare 说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)
- [配置层加载规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/boot/app-boot/README.md)
- [pnpm 生命周期](https://pnpm.io/scripts)
- [pnpm pack 生命周期](https://pnpm.io/cli/pack#life-cycle-scripts)
