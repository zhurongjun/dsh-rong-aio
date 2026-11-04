# 安装与维护

兼容基线为 **DeepSeek Harness `0.2.1-rc.5`**。Desktop 与 Web 使用各自的 profile，安装在 Web 的插件不会自动出现在 Desktop。

## 先构建源码

在 Node.js `^22.19.0 || >=24.0.0`、pnpm `11.25.0` 下执行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

构建输出 `lib/index.js`、`lib/index.d.ts`、`lib/client.js`。宿主入口提供速度设置持久化与请求参数适配；浏览器代码通过 DSH `__ModuleLoader__` 模块工厂加载，React 与 UI primitives 由 DSH 提供。插件本身不运行安装生命周期脚本。

## Desktop

1. 在 DSH 的“插件”页面点击“添加插件”。
2. 填入构建后的源码目录绝对路径，例如 `/Users/rong/workspace/project/dsh-rong-aio`。
3. 安装后选择“立即启用”。若界面要求重新加载或重启，按提示执行。
4. 打开会话，点击输入框的模型名称，应直接出现强度滑块；点击顶部标题进入模型列表。

通过本地目录安装通常是链接，需要保留该目录。移动仓库后应先卸载，再从新路径安装。不要修改应用安装目录或通过 CLI 绕过 Desktop 的 profile 管理。

## Web

以下命令中的 `dsh` 必须来自 `0.2.1-rc.5`。没有全局命令时，将 `dsh` 替换为 `pnpm dlx @deepseek-ai/dsh@0.2.1-rc.5`。

```sh
dsh plugin --profile web add /absolute/path/to/dsh-rong-aio
dsh --profile web --dump-config
dsh --profile web
```

配置应包含 `id: rong-aio-model-selector`、`name: dsh-rong-aio`。已有实例需要重新加载/重启后验证。

路径按 DSH 宿主机器解析；远程 Web 应填写服务器上的路径。

## 干净检出与离线安装包

本项目不提交 `lib/`，也不在安装时执行构建。因此固定 Git 提交的完整安装流程为：

```sh
git clone https://github.com/zhurongjun/dsh-rong-aio.git
cd dsh-rong-aio
git checkout <完整提交 SHA>
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm pack --pack-destination agent_temp/packages
```

该提交必须已经推送并包含本功能文件。当前工作区未提交的修改不会出现在远程检出中。然后安装构建后的本地目录，或将生成的 `dsh-rong-aio-0.1.0.tgz` 安装到目标 DSH：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-rong-aio/agent_temp/packages/dsh-rong-aio-0.1.0.tgz
```

Desktop 可在“添加插件”的包名或地址中填写本地包路径。安装包只包含运行产物、配置层和说明，目标机器无需 pnpm 开发依赖。暂不支持直接填写 `github:...#SHA` 让 DSH 自动构建；如以后需要，应独立设计分发流程。

## 更新、启停、卸载和回退

- **本地开发更新**：运行 `pnpm check && pnpm build` 后重新加载 DSH；修改包清单或配置层后重启验证。
- **停用**：在插件页面关闭 `dsh-rong-aio`，原选择器恢复；不会删掉会话选择。
- **重新启用**：打开同一开关。官方模型目录插件必须保持启用。
- **Desktop 卸载**：使用插件详情的卸载操作。
- **Web 卸载**：`dsh plugin --profile web remove dsh-rong-aio`。
- **安装包更新/回退**：记录启用状态，卸载后安装另一个已验证的包，再恢复启用状态。

本地安装副本与 Git 提交独立。

## 排查

| 现象                                    | 检查                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| 找不到 `lib/index.js` / `lib/client.js` | 源码安装前执行 `pnpm build`                                                              |
| 仍显示原生双层菜单                      | 确认插件在当前 profile 启用并重新加载；检查是否有其他模型插槽插件竞争                    |
| 没有推理档位                            | 当前 provider/model 没有通过 DSH 目录声明档位；应在 DSH 模型配置中核实，不按模型名字猜测 |
| Fast 灰色                               | 检查型号允许列表、连接协议与宿主速度接口；未支持的组合保持禁用                           |
| 保存失败                                | 弹窗显示实际错误，回退原值；检查会话锁、连接与模型路由，再重试                           |
| 模型目录加载失败                        | 点击“重新加载”，检查 DSH 提供商设置                                                      |
| 版本不兼容                              | 当前只验证 rc.5，不启用兼容豁免                                                          |

## 官方依据

- [目标版本安装指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/docs/user/develop/basic/publish.md)
- [配置层加载规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/boot/app-boot/README.md)
- [官方模型选择器](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5/packages/client/ui-model-selection)

## Fast 宿主扩展更新

本版本同时包含浏览器选择器和宿主速度参数适配。源码更新后运行 `pnpm check && pnpm build`，再重启 DSH；仅刷新 Web 页面不会重新载入宿主模块。速度状态通过 DSH 的 storageDomain 保存在当前 profile 中，重启不会丢失；停用插件即停止参数注入，重新启用恢复已保存设置。安装压缩包无需额外安装运行依赖，Zod 随宿主产物打包。
