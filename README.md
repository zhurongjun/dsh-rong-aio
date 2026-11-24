# dsh-rong-aio

DeepSeek Harness 功能组合插件（兼容 DSH `0.2.2-rc.5` 与 `0.2.2-rc.3`），单包安装，各组件可在宿主插件设置中独立启停：

- **模型选择器**（`model-selector`）：模型检索、推理强度、Fast 速度档位与 Agent Team 开关。
- **破甲模式**（`system-inject`）：Markdown 模板库、新会话显式选词、首轮请求快照冻结与精确模型白名单。
- **会话管理**（`session-manager`）：会话检索、批量归档、复原与永久删除。
- **侧聊**（`side`）：从主会话分叉独立问答、权限隔离与历史恢复。

## 安装

- **DSH Desktop**：在 **插件 → 添加插件** 中输入 `dsh-rong-aio`（未走 npm 时可填入 [Releases](https://github.com/zhurongjun/dsh-rong-aio/releases) 中的 `.tgz` 地址或本地 `.tgz` 路径），安装后启用。
- **DSH CLI / Web**：
  ```sh
  dsh plugin --profile web add dsh-rong-aio
  ```

## 开发

环境要求：Node.js `^22.19.0 || >=24.0.0`、pnpm `11.25.0`。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm pack --pack-destination agent_temp/packages && pnpm verify:package
```

## 许可证

[GPL-3.0-only](LICENSE)
