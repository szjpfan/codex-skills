---
name: feishu-codexbridge-connector
description: 将飞书机器人接入 CodexBridge，使飞书消息通过 Codex 的桥接层（session/router/provider）与用户对话。当用户需要把飞书和 Codex 打通、部署飞书 AI 机器人、或通过飞书与 Codex 交互时使用此 skill。
---

# 飞书 ↔ Codex 接入

## 适用边界

这个 skill 解决"把飞书机器人接入 CodexBridge"的完整流程：拉仓 → 补齐飞书源码 → 配置凭据 → 构建 → 启动/常驻服务 → 验证。

- 用户要接入飞书：使用此 skill
- 用户要管理已部署的飞书服务（重启、查日志、卸载）：使用此 skill
- 用户只是在问飞书 SDK 接口或纯代码问题：做常规分析，不套此 skill

## 前提条件

- Node.js ≥ 20（`node --version`）
- 飞书开放平台已创建自建应用，具备"接收消息"和"发送消息"权限
- 飞书应用的"事件与回调"已切换到**长连接模式**（WebSocket）
- 本机已安装并登录 Codex CLI / Codex app，可通过 Codex 订阅路径使用 `openai-default`

## 快速概览

接入链路：

```
飞书用户消息 → 飞书服务端 → WebSocket 长连接 → CodexBridge FeishuPlugin
→ BridgeRuntime → BridgeCoordinator → Codex app-server (`openai-default`) → 回复逆路径返回
```

如果仓库还没有飞书源码，先运行本 skill 自带的 `scripts/install_feishu_support.mjs` 补齐实现。完成接入后，运行 `npm run feishu:serve` 启动服务；macOS 上可通过 launchd 常驻。

## 操作流程

按顺序执行以下步骤。每步成功后向用户汇报进度。

### 1. 拉取仓库并安装依赖

```bash
git clone https://github.com/Gan-Xing/CodexBridge.git
cd CodexBridge
npm install
```

如果用户指定了不同的安装目录，使用用户指定的路径。

### 2. 补齐飞书平台实现

先检查当前 CodexBridge 是否已有飞书实现：

```bash
test -f src/platforms/feishu/plugin.ts && test -f src/runtime/feishu_bridge_runtime.ts
```

如果缺失，运行 skill 自带安装脚本。将 `<skill-dir>` 替换为当前 skill 目录，通常是 `~/.codex/skills/feishu-codexbridge-connector`：

```bash
node <skill-dir>/scripts/install_feishu_support.mjs "$(pwd)"
npm install
npm run typecheck
npx tsx --test test/platforms/feishu/plugin.test.ts
```

脚本会自动写入：

- `src/platforms/feishu/plugin.ts`
- `src/runtime/feishu_bridge_runtime.ts`
- `test/platforms/feishu/plugin.test.ts`
- `config/examples/feishu.service.env.example`
- `package.json` 的 `feishu:serve` script 和 `@larksuiteoapi/node-sdk` 依赖
- `src/cli.ts` 的 `feishu serve` 命令
- `src/index.ts`、`src/i18n/index.ts` 的 Feishu 注册和文案
- `src/providers/codex/app_client.ts` 的 `OPENAI_API_KEY` 默认剥离逻辑，避免误走 API 计费路径

如果脚本提示 `anchor not found`，说明上游 CodexBridge 结构变了；读取 [references/architecture.md](references/architecture.md) 和脚本源码，按同样文件边界手动适配。

### 3. 配置飞书凭据

向用户询问以下信息，逐一收集（注意不要打印完整密钥到日志里）：

- `FEISHU_APP_ID` — 飞书应用 App ID（`cli_` 开头）
- `FEISHU_APP_SECRET` — 飞书应用 App Secret
- `FEISHU_VERIFICATION_TOKEN` — 飞书事件验证 Token
- `FEISHU_ENCRYPT_KEY` — （可选）事件加密 Key

同时确认 Codex provider 配置：

- 默认使用 `CODEX_DEFAULT_PROVIDER_PROFILE_ID=openai-default`
- 确认 `codex` 命令可用，并且 `codex login` 已完成
- 不要为了走 Codex 订阅路径配置 `OPENAI_API_KEY`

将凭据写入项目根目录 `.env.local`：

```bash
# .env.local in CodexBridge repo root
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=

CODEX_NATIVE_API_ENABLE=1
CODEX_DEFAULT_PROVIDER_PROFILE_ID=openai-default
CODEX_REAL_BIN=/usr/local/bin/codex
```

如果用户明确要求走 OpenAI API 计费路径，才允许配置 `OPENAI_API_KEY`；否则必须避免把 `OPENAI_API_KEY` 传给 Codex app-server。

### 4. 构建与类型检查

```bash
npm run typecheck
npm run build
```

两者都必须通过才能继续。

### 5. 跑飞书插件单元测试

```bash
node ./scripts/test.mjs test/platforms/feishu/plugin.test.ts
```

必须全部通过。

### 6. 一次性启动烟测

用临时 state 目录启动，禁用内嵌 Native API，确认飞书 WebSocket 能连上：

```bash
CODEX_NATIVE_API_ENABLE=0 npm run feishu:serve -- \
  --state-dir /tmp/codexbridge-feishu-smoke \
  --cwd "$(pwd)" &
pid=$!
sleep 6
kill "$pid" 2>/dev/null || true
wait "$pid"
rm -f /tmp/codexbridge-feishu-smoke/runtime/feishu-serve.lock
```

期望日志中出现：

```
[info]: [ '[ws]', 'ws client ready' ]
```

如果出现认证错误，回到步骤 2 检查凭据。

### 7. 安装常驻服务（macOS launchd）

若用户的 macOS 上已有旧飞书机器人 launchd 服务，先卸载：

```bash
# 检查旧服务
launchctl list | rg 'feishu'
# 卸载（如有）
launchctl bootout "gui/$UID" "com.naodongfan.feishu-ai-bot" 2>/dev/null || true
```

将凭据复制为服务环境文件：

```bash
mkdir -p "$HOME/.config/codexbridge"
cp .env.local "$HOME/.config/codexbridge/feishu.service.env"
chmod 600 "$HOME/.config/codexbridge/feishu.service.env"

# 补充 CodexBridge 内部需要的默认值
{
  printf 'CODEX_NATIVE_API_ENABLE=1\n'
  printf 'CODEX_DEFAULT_PROVIDER_PROFILE_ID=openai-default\n'
  printf 'CODEX_REAL_BIN=%s\n' "$(command -v codex || true)"
} >> "$HOME/.config/codexbridge/feishu.service.env"
```

安装并启动 launchd 服务：

```bash
PLATFORM=feishu \
CODEXBRIDGE_DEFAULT_CWD="$(pwd)" \
bash scripts/service/install-launchd-user.sh
```

验证服务状态：

```bash
LABEL=com.ganxing.codexbridge-feishu bash scripts/service/status-launchd-user.sh
```

期望：`state = running`

### 8. 验证对话

在飞书中向机器人发送一条测试消息（如 "你好"），确认收到回复。

查看实时日志：

```bash
PLATFORM=feishu bash scripts/service/logs-launchd-user.sh
```

## 常用运维命令

```bash
cd /path/to/CodexBridge

# 状态
LABEL=com.ganxing.codexbridge-feishu bash scripts/service/status-launchd-user.sh

# 日志
PLATFORM=feishu bash scripts/service/logs-launchd-user.sh

# 重启
LABEL=com.ganxing.codexbridge-feishu bash scripts/service/restart-launchd-user.sh

# 卸载
launchctl bootout "gui/$UID" "com.ganxing.codexbridge-feishu"
```

## 故障排查

遇到问题时按以下顺序排查：

1. 飞书凭据是否正确 → 对照飞书开放平台"凭证与基础信息"页
2. 飞书事件订阅是否设为长连接模式 → 开发者后台 → 事件与回调 → 订阅方式
3. 机器人是否有接收和发送消息的权限 → 开发者后台 → 权限管理
4. 服务是否在运行 → `launchctl list | rg feishu`
5. Provider 是否可用 → 确认 `/provider openai-default`，并检查 `codex login` 状态
6. 飞书 SDK 日志详情 → 在启动命令中添加 `FEISHU_DEBUG=1`

如果飞书返回 `429 You exceeded your current quota ... platform.openai.com/docs/guides/error-codes/api-errors`，优先检查是否还有旧的飞书机器人服务在运行，例如 `com.naodongfan.feishu-ai-bot`。该错误通常来自直接调用 OpenAI API 的旧服务，而不是 Codex 订阅路径。

## 架构说明

详见 [references/architecture.md](references/architecture.md)。

## 技能结构

```
feishu-codexbridge-connector/
├── SKILL.md              ← 当前文件（操作流程）
├── scripts/
│   └── install_feishu_support.mjs
├── assets/
│   └── feishu-files/     ← 飞书平台源码模板
└── references/
    └── architecture.md   ← 架构说明与关键文件索引
```

此 skill 的安装脚本只写 CodexBridge 源码和 package 配置，不写任何密钥。飞书凭据仍必须在目标电脑本地配置。
