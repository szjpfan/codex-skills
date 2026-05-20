#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, '..');
const assetRoot = path.join(skillDir, 'assets', 'feishu-files');
const repoRoot = path.resolve(process.argv[2] ?? process.cwd());

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function write(relativePath, content) {
  const target = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function copyAsset(relativePath) {
  write(relativePath, fs.readFileSync(path.join(assetRoot, relativePath), 'utf8'));
}

function replaceOnce(content, search, replacement, file) {
  if (content.includes(replacement)) {
    return content;
  }
  if (!content.includes(search)) {
    throw new Error(`Cannot patch ${file}: anchor not found: ${search.slice(0, 120)}`);
  }
  return content.replace(search, replacement);
}

function insertAfter(content, anchor, insertion, file) {
  if (content.includes(insertion.trim())) {
    return content;
  }
  if (!content.includes(anchor)) {
    throw new Error(`Cannot patch ${file}: anchor not found: ${anchor.slice(0, 120)}`);
  }
  return content.replace(anchor, `${anchor}${insertion}`);
}

function patchPackageJson() {
  const file = 'package.json';
  const json = JSON.parse(read(file));
  json.scripts ??= {};
  json.dependencies ??= {};
  json.scripts['feishu:serve'] ??= 'tsx src/cli.ts feishu serve';
  json.dependencies['@larksuiteoapi/node-sdk'] ??= '^1.64.0';
  write(file, `${JSON.stringify(json, null, 2)}\n`);
}

function patchCli() {
  const file = 'src/cli.ts';
  let content = read(file);
  content = insertAfter(
    content,
    "import { WeixinPlatformPlugin } from './platforms/weixin/plugin.js';\n",
    "import { FeishuPlatformPlugin } from './platforms/feishu/plugin.js';\n",
    file,
  );
  content = insertAfter(
    content,
    "import { WeixinBridgeRuntime } from './runtime/weixin_bridge_runtime.js';\n",
    "import { FeishuBridgeRuntime } from './runtime/feishu_bridge_runtime.js';\n",
    file,
  );
  content = insertAfter(
    content,
    "interface WeixinServeArgs {\n  stateDir: string | null;\n  cwd: string | null;\n}\n",
    "\ninterface FeishuServeArgs {\n  stateDir: string | null;\n  cwd: string | null;\n}\n",
    file,
  );
  content = insertAfter(
    content,
    "  if (group === 'weixin' && command === 'serve') {\n    return runWeixinServe(args);\n  }\n",
    "  if (group === 'feishu' && command === 'serve') {\n    return runFeishuServe(args);\n  }\n",
    file,
  );
  content = insertAfter(
    content,
    "\nasync function runWeixinServe(args: string[]) {\n",
    "",
    file,
  );
  if (!content.includes('async function runFeishuServe(args: string[])')) {
    content = content.replace(
      "\nasync function runCodexCleanupInternalThreads(args: string[]) {\n",
      `${feishuServeFunction()}\nasync function runCodexCleanupInternalThreads(args: string[]) {\n`,
    );
  }
  if (!content.includes('function parseFeishuServeArgs(args: string[])')) {
    content = content.replace(
      "\nfunction parseWeixinClearContextArgs(args: string[]): WeixinClearContextArgs {\n",
      `${parseFeishuServeArgsFunction()}\nfunction parseWeixinClearContextArgs(args: string[]): WeixinClearContextArgs {\n`,
    );
  }
  content = insertAfter(
    content,
    "    createI18n().t('cli.usage.serve'),\n",
    "    createI18n().t('cli.usage.feishuServe'),\n",
    file,
  );
  content = insertAfter(
    content,
    "  parseCodexCleanupInternalThreadsArgs,\n",
    "  parseFeishuServeArgs,\n",
    file,
  );
  write(file, content);
}

function patchIndex() {
  const file = 'src/index.ts';
  let content = read(file);
  content = insertAfter(
    content,
    "import { TelegramPlatformPlugin } from './platforms/telegram/plugin.js';\n",
    "import { FeishuPlatformPlugin } from './platforms/feishu/plugin.js';\n",
    file,
  );
  content = insertAfter(
    content,
    "  TelegramPlatformPlugin,\n",
    "  FeishuPlatformPlugin,\n",
    file,
  );
  content = insertAfter(
    content,
    "      new TelegramPlatformPlugin(),\n",
    "      new FeishuPlatformPlugin(),\n",
    file,
  );
  write(file, content);
}

function patchI18n() {
  const file = 'src/i18n/index.ts';
  let content = read(file);
  content = insertAfter(
    content,
    "    'cli.serve.restartCompleted': '桥接已重启完成。\\n现在可以继续发消息了。',\n",
    "    'cli.feishuServe.starting': '启动 Feishu bridge',\n    'cli.feishuServe.stopping': '收到 {signal}，正在停止 Feishu bridge...',\n",
    file,
  );
  content = insertAfter(
    content,
    "    'cli.usage.serve': '  npm run weixin:serve -- [--state-dir DIR] [--cwd DIR]',\n",
    "    'cli.usage.feishuServe': '  npm run feishu:serve -- [--state-dir DIR] [--cwd DIR]',\n",
    file,
  );
  content = insertAfter(
    content,
    "    'cli.serve.restartCompleted': 'Bridge restart completed.\\nYou can continue sending messages now.',\n",
    "    'cli.feishuServe.starting': 'Starting Feishu bridge',\n    'cli.feishuServe.stopping': 'Received {signal}; stopping the Feishu bridge...',\n",
    file,
  );
  content = insertAfter(
    content,
    "    'cli.usage.serve': '  npm run weixin:serve -- [--state-dir DIR] [--cwd DIR]',\n",
    "    'cli.usage.feishuServe': '  npm run feishu:serve -- [--state-dir DIR] [--cwd DIR]',\n",
    file,
  );
  write(file, content);
}

function patchCodexAppClientEnv() {
  const file = 'src/providers/codex/app_client.ts';
  let content = read(file);
  if (content.includes('createCodexAppServerEnv(')) {
    return;
  }
  content = insertAfter(content, "  platform?: NodeJS.Platform;\n", "  env?: NodeJS.ProcessEnv;\n", file);
  content = insertAfter(content, "  platform: NodeJS.Platform;\n", "\n  env: NodeJS.ProcessEnv;\n", file);
  content = insertAfter(content, "    platform = process.platform,\n", "    env = process.env,\n", file);
  content = insertAfter(content, "    this.platform = platform;\n", "    this.env = createCodexAppServerEnv(env);\n", file);
  content = content.replaceAll(
    "        stdio: 'ignore',\n      });",
    "        stdio: 'ignore',\n        env: this.env,\n      });",
  );
  content = content.replaceAll(
    "          stdio: transportKind === 'stdio' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],\n          ...launchSpec.options,\n        })",
    "          stdio: transportKind === 'stdio' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],\n          env: this.env,\n          ...launchSpec.options,\n        })",
  );
  content = content.replaceAll(
    "          stdio: transportKind === 'stdio' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],\n          ...launchSpec.options,\n        });",
    "          stdio: transportKind === 'stdio' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],\n          env: this.env,\n          ...launchSpec.options,\n        });",
  );
  content = content.replace(
    "\nfunction waitForChildExit(child: ChildProcess | null, timeoutMs: number): Promise<void> {\n",
    `${codexEnvHelpers()}\nfunction waitForChildExit(child: ChildProcess | null, timeoutMs: number): Promise<void> {\n`,
  );
  write(file, content);
}

function feishuServeFunction() {
  return `
async function runFeishuServe(args: string[]) {
  const i18n = createI18n();
  const options = parseFeishuServeArgs(args);
  const stateDir = path.resolve(options.stateDir ?? defaultCodexBridgeStateDir());
  const defaultCwd = path.resolve(options.cwd ?? process.env.CODEXBRIDGE_DEFAULT_CWD ?? process.cwd());
  const serveLock = await acquireServeLock(path.join(stateDir, 'runtime', 'feishu-serve.lock'));
  const repositories = createFileJsonRepositories(path.join(stateDir, 'runtime'));
  const codexProfiles = loadCodexProfilesFromEnv();
  const codexAuthManager = createWeixinServeCodexAuthManager(stateDir);
  const runtime = createCodexBridgeRuntime({
    platformPlugins: [
      new FeishuPlatformPlugin(),
    ],
    providerPlugins: [
      new OpenAINativeProviderPlugin(),
      new OpenAICompatibleProviderPlugin(),
    ],
    providerProfiles: codexProfiles.profiles,
    defaultProviderProfileId: codexProfiles.defaultProviderProfileId,
    defaultCwd,
    locale: i18n.locale,
    repositories,
    assistantAttachmentRoot: path.join(stateDir, 'assistant', 'attachments'),
    codexAuthManager,
    codexGoalManager: createWeixinServeCodexGoalManager(stateDir),
  });
  const platformPlugin = runtime.registry.getPlatform('feishu') as FeishuPlatformPlugin;
  const bridgeRuntime = new FeishuBridgeRuntime({
    platformPlugin,
    bridgeCoordinator: runtime.services.bridgeCoordinator,
    automationJobs: runtime.services.automationJobs,
    agentJobs: runtime.services.agentJobs,
    assistantRecords: runtime.services.assistantRecords,
    onError: async (error: unknown) => {
      process.stderr.write(\`[feishu] \${formatError(error)}\\n\`);
    },
    locale: i18n.locale,
  });
  const embeddedNativeApiOptions = resolveEmbeddedCodexNativeApiOptions({
    env: process.env,
    defaultProviderProfileId: runtime.config.defaultProviderProfileId,
  });
  const nativeApi = embeddedNativeApiOptions.enabled
    ? new CodexNativeApiService({
      providerProfiles: runtime.repositories.providerProfiles,
      providerRegistry: runtime.registry,
      defaultProviderProfileId: runtime.config.defaultProviderProfileId,
      providerProfileId: embeddedNativeApiOptions.providerProfileId,
      authPath: codexAuthManager.authPath,
      env: process.env,
      host: embeddedNativeApiOptions.host,
      port: embeddedNativeApiOptions.port,
      authToken: embeddedNativeApiOptions.authToken,
      defaultModel: embeddedNativeApiOptions.defaultModel,
      defaultCwd,
      defaultLocale: i18n.locale,
      requestTitlePrefix: embeddedNativeApiOptions.requestTitlePrefix,
    })
    : null;

  process.stdout.write(\`\${i18n.t('cli.feishuServe.starting')}\\n\`);
  process.stdout.write(\`state_dir: \${stateDir}\\n\`);
  process.stdout.write(\`default_provider_profile: \${runtime.config.defaultProviderProfileId}\\n\`);
  process.stdout.write(\`serve_lock: \${serveLock.lockPath}\\n\`);
  process.stdout.write(\`\${i18n.t('cli.serve.defaultCwd', { value: runtime.config.defaultCwd ?? i18n.t('common.none') })}\\n\`);
  process.stdout.write(\`native_api_enabled: \${nativeApi ? 'true' : 'false'}\\n\`);

  let stopped = false;
  let resolveStopped: (() => void) | null = null;
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  process.once('exit', () => {
    serveLock.releaseSync();
  });
  const stop = async (signal: string) => {
    if (stopped) {
      return;
    }
    stopped = true;
    process.stdout.write(\`\${i18n.t('cli.feishuServe.stopping', { signal })}\\n\`);
    try {
      await bridgeRuntime.stop();
      await nativeApi?.stop().catch(() => {});
    } finally {
      await stopRuntimeProviderPlugins(runtime.registry.listProviders());
      await serveLock.release();
      resolveStopped?.();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => { void stop('SIGINT'); });
  process.on('SIGTERM', () => { void stop('SIGTERM'); });

  try {
    if (nativeApi) {
      const binding = await nativeApi.start();
      process.stdout.write(\`native_api_base_url: \${nativeApi.baseUrl}\\n\`);
      process.stdout.write(\`native_api_provider_profile: \${binding.providerProfileId}\\n\`);
      process.stdout.write(\`native_api_provider_kind: \${binding.providerKind}\\n\`);
      process.stdout.write(\`native_api_auth_mode: \${embeddedNativeApiOptions.authToken ? i18n.t('common.enabled') : i18n.t('common.disabled')}\\n\`);
    }
    await bridgeRuntime.start();
    await stoppedPromise;
  } finally {
    if (!stopped) {
      await bridgeRuntime.stop().catch(() => {});
      await nativeApi?.stop().catch(() => {});
      await stopRuntimeProviderPlugins(runtime.registry.listProviders());
      await serveLock.release();
    }
  }
}

`;
}

function parseFeishuServeArgsFunction() {
  return `
function parseFeishuServeArgs(args: string[]): FeishuServeArgs {
  const options: FeishuServeArgs = {
    stateDir: null,
    cwd: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--state-dir' && next) {
      options.stateDir = next;
      index += 1;
      continue;
    }
    if (arg === '--cwd' && next) {
      options.cwd = next;
      index += 1;
    }
  }
  return options;
}

`;
}

function codexEnvHelpers() {
  return `
function createCodexAppServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  if (parseBooleanEnv(next.CODEXBRIDGE_ALLOW_CODEX_OPENAI_API_KEY, false)) {
    return next;
  }
  delete next.OPENAI_API_KEY;
  return next;
}

function parseBooleanEnv(value: unknown, fallback = false): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

`;
}

copyAsset('src/platforms/feishu/plugin.ts');
copyAsset('src/runtime/feishu_bridge_runtime.ts');
copyAsset('test/platforms/feishu/plugin.test.ts');
copyAsset('config/examples/feishu.service.env.example');
patchPackageJson();
patchCli();
patchIndex();
patchI18n();
patchCodexAppClientEnv();

console.log(`Feishu support installed into ${repoRoot}`);
console.log('Next: npm install && npm run typecheck && npx tsx --test test/platforms/feishu/plugin.test.ts');
