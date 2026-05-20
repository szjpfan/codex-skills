# codex-skills

Reusable Codex skills for local automation workflows.

## Available Skill

### feishu-codexbridge-connector

This skill helps Codex connect a Feishu bot to [CodexBridge](https://github.com/Gan-Xing/CodexBridge) through Feishu's WebSocket long-connection event mode.

It now includes both:

- Deployment instructions for an existing Feishu-enabled CodexBridge checkout.
- A self-contained installer script that can add the missing Feishu source files and CLI wiring when upstream CodexBridge does not include them yet.

Use it when you want to:

- Deploy a Feishu bot that talks to Codex through CodexBridge.
- Reuse the same Feishu integration workflow on another Mac or Windows machine.
- Patch a fresh `Gan-Xing/CodexBridge` clone with Feishu support.
- Troubleshoot the CodexBridge Feishu service, logs, provider profile, or old duplicate bot services.

The skill is stored at:

```text
skills/feishu-codexbridge-connector/
  SKILL.md
  agents/openai.yaml
  scripts/install_feishu_support.mjs
  assets/feishu-files/
  references/architecture.md
```

## Install The Skill On Another Computer

Clone this repository and symlink the skill into Codex's local skills directory:

```bash
git clone https://github.com/szjpfan/codex-skills.git ~/codex-skills
mkdir -p ~/.codex/skills
ln -s ~/codex-skills/skills/feishu-codexbridge-connector ~/.codex/skills/feishu-codexbridge-connector
```

On Windows, copy or junction the folder into the Codex skills directory used by that machine.

Restart Codex after installing the skill.

Then ask Codex:

```text
使用 feishu-codexbridge-connector skill，帮我接入飞书
```

## Patch A Fresh CodexBridge Clone

If `src/platforms/feishu/` does not exist in `Gan-Xing/CodexBridge`, run the installer script from this skill:

```bash
cd /path/to/CodexBridge
node ~/.codex/skills/feishu-codexbridge-connector/scripts/install_feishu_support.mjs "$(pwd)"
npm install
npm run typecheck
npx tsx --test test/platforms/feishu/plugin.test.ts
```

The script adds the Feishu platform plugin, Feishu runtime, CLI command, environment example, dependency, unit test, and Codex subscription-path protection.

## Requirements

Each computer still needs its own local runtime setup:

- Node.js 20 or newer.
- Git.
- Codex CLI / Codex app installed and logged in.
- A local clone of `Gan-Xing/CodexBridge`.
- A Feishu custom app with message receive/send permissions.
- Feishu Events and Callbacks configured to use long connection mode.

## Provider Path

The skill is written for the Codex subscription path, not direct OpenAI API billing.

Use:

```env
CODEX_NATIVE_API_ENABLE=1
CODEX_DEFAULT_PROVIDER_PROFILE_ID=openai-default
CODEX_REAL_BIN=/usr/local/bin/codex
```

Do not configure `OPENAI_API_KEY` unless you explicitly want the OpenAI API billing path.

## Multi-Computer Note

Do not run the same Feishu app's long-connection bot service on multiple computers at the same time. Multiple active long connections can cause duplicate replies or confusing errors.

If another old Feishu bot service is still running, stop it before using CodexBridge. One known old service label is:

```bash
launchctl bootout "gui/$UID" "com.naodongfan.feishu-ai-bot" 2>/dev/null || true
```

## Secrets

This repository intentionally stores only reusable instructions and source templates. Do not commit Feishu app secrets, verification tokens, OpenAI API keys, or local `.env` files.
