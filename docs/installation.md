# 安装与维护

支持 **DeepSeek Harness `0.2.2-rc.3`**。开发依赖与 API 验证均固定在该版本；插件清单仅声明当前维护基线，DSH 会在加载组件前核对 `engines.dsh`。Desktop 与 Web 使用各自的 profile，安装来源、构建许可和启用状态分别管理。

## Release 安装入口（推荐）

在 [GitHub Releases](https://github.com/zhurongjun/dsh-rong-aio/releases) 选择版本，复制其 `.tgz` 附件链接。`v0.1.0` 的安装地址为：

```text
https://github.com/zhurongjun/dsh-rong-aio/releases/download/v0.1.0/dsh-rong-aio-0.1.0.tgz
```

Desktop 在“插件 → 添加插件”中粘贴该地址，安装成功后点击“立即启用”。Web 使用固定版本 DSH：

```sh
dsh plugin --profile web add 'https://github.com/zhurongjun/dsh-rong-aio/releases/download/v0.1.0/dsh-rong-aio-0.1.0.tgz'
```

Release 的 `.tgz` 是 `pnpm pack` 生成的预构建 npm 包，含 `lib/`、组件清单与 bundle patch；不需要用户机器上的 Git、开发依赖或本插件构建许可。不要安装 GitHub 自动生成的 **Source code (zip/tar.gz)**，它们只有源码，没有 `lib/`。Release 页面 URL 也不是安装 spec，必须使用 `.tgz` 附件的直链。DSH 宿主需能访问 GitHub 下载域名；npm 镜像不会代理 Release 附件。

也可下载 `.tgz` 和同名 `.sha256` 到同一目录，校验后按下文“安装包”方式安装本地文件。Linux 用 `sha256sum --check dsh-rong-aio-0.1.0.tgz.sha256`；macOS 用 `shasum -a 256 --check dsh-rong-aio-0.1.0.tgz.sha256`。更新或回退时先卸载，再安装目标版本；固定 URL 不会自动跟随新 Release。

## Git 源码安装入口

需要安装源码时，推荐使用固定提交：

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

## Desktop 的 Git 安装

1. 若已安装本插件的本地目录或旧版本，先在“插件 → dsh-rong-aio”详情中卸载；同名包不能重复添加。
2. 点击“添加插件”，填入上面的 Git spec，将提交占位符替换为实际值，点击“安装”。
3. 首次安装可能被 pnpm 的构建许可拦下。展开“查看安装详情”，核对请求运行的是本插件的构建脚本；若提供“允许这些脚本并重试”，确认列表只包含本次需要的包后使用该按钮。
4. 安装完成后点击“立即启用”。按界面提示重新加载或重启；重新打开会话，模型按钮应直接显示强度滑块，顶部标题可进入模型搜索。

若 Git 构建错误未被界面识别为可批准的包，关闭弹窗，按 pnpm 错误输出将**完整且精确的键**加入当前 Desktop profile 的 `pnpm-workspace.yaml` 中已有的 `allowBuilds` 映射，再重试同一个 spec。默认文件位置为 `$DSH_HOME/profiles/desktop/pnpm-workspace.yaml`，未设置 `DSH_HOME` 时为 `~/.dsh/profiles/desktop/pnpm-workspace.yaml`。保留该文件其他配置；不设置全局忽略限制或允许全部脚本，不用 CLI 绕过 Desktop 的 profile 管理。

构建许可允许包以宿主用户权限运行构建代码，只批准信任的源码。Git 来源的键可能包含 URL 和提交号，必须以当前 pnpm 输出为准；升级到另一个提交可能需要再次许可。仓库内对 esbuild、koffi 的开发构建许可不代替 DSH profile 对本插件的许可。

## Web 的 Git 安装

以下命令中的 `dsh` 须使用上文列出的版本。没有全局命令时，可用 `pnpm dlx @deepseek-ai/dsh@0.2.2-rc.3` 代替 `dsh`。

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

## 发布与插件发现

`.github/workflows/ci.yml` 在主分支推送与 PR 时执行 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm build`、打包和隔离安装验证。Node.js 使用 24 系列，pnpm 从根包 `packageManager` 读取固定版本；第三方 Actions 固定到提交。只有 `v*` Tag 的检查全部通过，具有 `contents: write` 权限的独立发布 job 才会创建 Release。

发布一个新版本：

1. 同步修改根包与 `src/components/*/package.json` 的版本，维护安装说明中的示例版本和 DSH 兼容范围。
2. 执行 `pnpm check`、`pnpm build`、`pnpm pack --pack-destination agent_temp/packages` 和 `RELEASE_TAG=vX.Y.Z node scripts/check-package.mjs`，将 `X.Y.Z` 替换为新版本。
3. 提交源码后推送主分支，再创建并推送同版本的 Tag：

   ```sh
   git tag -a vX.Y.Z -m '发布 vX.Y.Z'
   git push origin main
   git push origin vX.Y.Z
   ```

4. 等待该 Tag 的 GitHub Actions 成功，核对 Release 中的 `.tgz` 与 `.tgz.sha256`。CI 先上传草稿附件，再公开 Release；带 `-rc.1` 等后缀的版本标为 prerelease，不设为 Latest。失败后可重跑以补全草稿，已经公开的 Release 不覆盖，修复应使用新版本和新 Tag。

根包版本必须与 Tag 完全一致，内部组件版本必须跟随根包。包内容校验拒绝工作文件、源码、测试和依赖目录，检查所有入口与 locale 已打包，并在独立目录以 `--ignore-scripts --prod` 安装，证明运行包无需安装时编译。校验和用于核对附件完整性，不是签名。流程不发布到 npm，也不改动 DSH profile。

GitHub 的两种“标签”用途不同：

- **Repository Topic `dsh-plugin`**：在仓库首页 About 的 Topics 中设置，供 GitHub 话题检索及采用该约定的社区目录发现。根包 `keywords` 提供相同关键词，但不能代替仓库 Topic。
- **Git Tag `vX.Y.Z`**：标识具体源码版本并触发本仓库 Release。DSH 官方索引生成器识别 `vX.Y.Z`、`X.Y.Z` 和 `<name>@X.Y.Z`，且要求该提交的包版本匹配。

根包声明 `dsh.bundle` 且不设置 `private: true`，符合官方索引生成器收录条件；内部组件仍为私有，只随根包安装。DSH `0.2.2-rc.3` 的原生“发现”由实验性的“自定义插件索引”提供，**不内置索引源，也不自动扫描 GitHub Topics**。用户需启用该组件并添加可信的索引 URL；是否收录和刷新由索引维护者决定。该版本索引格式只支持 npm 与固定提交 Git 来源，不能把 Release tarball 直接写成索引来源；Topic 或 Tag 不能保证原生“发现”即时展示，也不会让索引中的 Git 安装自动改用 Release 附件。

## 启停、卸载、更新和回退

- **整个插件启停**：在插件页面切换 `dsh-rong-aio` 总开关，控制全部功能组件。
- **单个功能启停**：进入详情的“包含的组件”，分别切换“模型选择器”和“破甲模式”。模型选择器开关管理 effort、Fast UI 与速度请求适配，停用后恢复官方选择器；官方模型目录插件须保持启用。破甲模式开关管理提示词注入与护栏，停用后按 DSH 原生规则重组系统提示词，用户文件保留。
- **状态沿用**：新组件默认开启；已有组件通过稳定 ID 保留当前 profile 的关闭覆盖，重启或总包重新启用不应重置。Desktop 与 Web 分别管理。
- **Desktop 卸载**：进入本插件详情并选择“卸载”，按提示重载或重启，已安装列表中应不再出现本插件。
- **Web 卸载**：`dsh plugin --profile web remove dsh-rong-aio`，然后重启已有实例。
- **Git 更新、重新安装或回退**：记录当前安装的提交及启用状态，卸载后安装目标提交的 spec，再启用。已安装副本不会随远程 push 或开发目录改动自动更新。
- **安装包更新或回退**：卸载后安装目标版本的包，再启用。
- **构建许可**：卸载可能保留当前 profile 的 `allowBuilds` 记录；不再信任某来源时可移除对应精确键，不影响其他包。

插件卸载不应作为清除会话或速度设置的方法。Fast 状态保存在当前 profile 的 storageDomain 中，停用即停止请求参数注入；重新安装并启用后沿用持久化设置。

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
| 版本不兼容                                 | 核对宿主版本和已安装副本的 `engines.dsh`；宿主升级后须安装支持该版本的插件包                 |

各组件的宿主入口分别提供速度适配与破甲模式服务；浏览器代码通过 DSH `__ModuleLoader__` 模块工厂加载，每个内部组件使用自己的模块身份；React、UI primitives、Cordis 与 Loader 由 DSH 提供。修改宿主代码、包清单或配置层后需重启 DSH，仅刷新 Web 页面不会重新载入宿主模块。Zod 随宿主产物打包。

## 官方依据

- [目标版本的 Git 安装与 prepare 说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)
- [官方 GitHub Topic 约定](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/README.zh.md#社区与支持)
- [原生插件索引与安装来源格式](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/guide/plugin-market.zh.md)
- [索引生成器的私有包过滤和 Tag 规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/apps/plugin-market-generator/README.zh.md)
- [配置层加载规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/boot/app-boot/README.md)
- [pnpm 生命周期](https://pnpm.io/scripts)
- [pnpm pack 生命周期](https://pnpm.io/cli/pack#life-cycle-scripts)
