# 飞书接入架构

## 关键文件索引

CodexBridge 仓库中与飞书接入直接相关的文件：

| 文件 | 作用 |
|------|------|
| `src/platforms/feishu/plugin.ts` | 飞书平台插件：实现 `PlatformPluginContract`，封装飞书 SDK WebSocket 客户端，处理消息收发、事件归一化、群/用户 allowlist |
| `src/runtime/feishu_bridge_runtime.ts` | 飞书桥接运行时：串联 platform plugin 和 bridge coordinator，负责消息轮询、发送重试、typing 指示、回复分片 |
| `src/cli.ts` | CLI 入口：包含 `feishu serve` 子命令和 `parseFeishuServeArgs` |
| `src/index.ts` | 公共导出：导出 `FeishuPlatformPlugin` |
| `src/i18n/index.ts` | 国际化文案：包含飞书 CLI 的中英文提示 |
| `test/platforms/feishu/plugin.test.ts` | 飞书插件单元测试 |
| `config/examples/feishu.service.env.example` | 飞书服务环境变量示例 |
| `scripts/service/install-launchd-user.sh` | macOS launchd 服务安装脚本（通过 `PLATFORM=feishu` 参数化） |
| `scripts/service/run-weixin-service.mjs` | 通用服务 runner（通过 `--platform feishu` 参数化） |

## Skill 自带安装资源

当远程 `Gan-Xing/CodexBridge` 还没有飞书实现时，本 skill 提供可直接落盘的实现资源：

| Skill 文件 | 作用 |
|------|------|
| `scripts/install_feishu_support.mjs` | 在目标 CodexBridge 仓库内补齐飞书源码、CLI 入口、依赖和 Codex 订阅路径保护 |
| `assets/feishu-files/src/platforms/feishu/plugin.ts` | 飞书平台插件源码模板 |
| `assets/feishu-files/src/runtime/feishu_bridge_runtime.ts` | 飞书 runtime 源码模板 |
| `assets/feishu-files/test/platforms/feishu/plugin.test.ts` | 飞书插件单元测试 |
| `assets/feishu-files/config/examples/feishu.service.env.example` | 飞书服务环境变量示例 |

推荐先运行：

```bash
node ~/.codex/skills/feishu-codexbridge-connector/scripts/install_feishu_support.mjs /path/to/CodexBridge
cd /path/to/CodexBridge
npm install
npm run typecheck
npx tsx --test test/platforms/feishu/plugin.test.ts
```

## 数据流

```
┌─────────────┐     WebSocket      ┌──────────────────────┐
│  飞书服务端   │ ◄────────────────► │  FeishuPlatformPlugin │
└─────────────┘                    │  (@larksuiteoapi/    │
                                   │   node-sdk WSClient) │
                                   └──────────┬───────────┘
                                              │ InboundTextEvent
                                   ┌──────────▼───────────┐
                                   │  FeishuBridgeRuntime  │
                                   │  (poll/event loop)    │
                                   └──────────┬───────────┘
                                              │ normalize + route
                                   ┌──────────▼───────────┐
                                   │   BridgeCoordinator   │
                                   │   (session/router)    │
                                   └──────────┬───────────┘
                                              │ provider call
                                   ┌──────────▼───────────┐
                                   │   Codex app-server    │
                                   │   (`openai-default`)  │
                                   └──────────────────────┘
```

## 飞书 SDK 接入细节

- 使用 `@larksuiteoapi/node-sdk` 的 `WSClient`（WebSocket 长连接）
- 消息事件类型：`im.message.receive_v1`
- 通过 `EventDispatcher` 注册事件处理器
- `normalizeInboundEvent` 将飞书消息转为平台无关的 `InboundTextEvent`
- 支持群聊和私聊的一对一映射（按 `chat_id` 区分 scope）
- 支持 `FEISHU_DM_ALLOW_FROM` 和 `FEISHU_GROUP_ALLOW_FROM` 白名单（逗号分隔的用户 open_id）

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | 是 | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是 | 飞书应用 App Secret |
| `FEISHU_VERIFICATION_TOKEN` | 否* | 事件验证 Token（长连接模式可选） |
| `FEISHU_ENCRYPT_KEY` | 否 | 事件加密 Key |
| `FEISHU_DM_ALLOW_FROM` | 否 | 私聊白名单，逗号分隔 open_id |
| `FEISHU_GROUP_ALLOW_FROM` | 否 | 群聊白名单，逗号分隔 chat_id |
| `CODEX_NATIVE_API_ENABLE` | 否 | 是否启用内嵌 Native API（默认 true） |
| `CODEX_DEFAULT_PROVIDER_PROFILE_ID` | 否 | 推荐设为 `openai-default`，走 Codex 订阅登录路径 |
| `CODEX_REAL_BIN` | 否 | `codex` CLI 路径，例如 `/usr/local/bin/codex` |

*长连接模式下 verification token 可选，但建议填写。

## 启动参数

```bash
npm run feishu:serve -- [--state-dir DIR] [--cwd DIR]
```

- `--state-dir`：状态目录（默认 `~/.codexbridge`），存放 serve lock、session 数据
- `--cwd`：Codex 工作目录（传给 provider 的 default cwd）
- 飞书凭据从 `.env` / `.env.local` / 环境变量读取
