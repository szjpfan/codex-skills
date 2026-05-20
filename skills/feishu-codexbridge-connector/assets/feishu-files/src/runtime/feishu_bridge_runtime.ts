import { WeixinBridgeRuntime } from './weixin_bridge_runtime.js';
import type { FeishuPlatformPlugin } from '../platforms/feishu/plugin.js';

interface FeishuBridgeRuntimeOptions {
  platformPlugin: FeishuPlatformPlugin;
  bridgeCoordinator: any;
  automationJobs?: any;
  agentJobs?: any;
  assistantRecords?: any;
  onError?: (error: unknown) => Promise<void> | void;
  locale?: string | null;
}

export class FeishuBridgeRuntime {
  constructor({
    platformPlugin,
    bridgeCoordinator,
    automationJobs = null,
    agentJobs = null,
    assistantRecords = null,
    onError = async () => {},
    locale = null,
  }: FeishuBridgeRuntimeOptions) {
    this.platformPlugin = platformPlugin;
    this.bridgeRuntime = new WeixinBridgeRuntime({
      platformPlugin,
      bridgeCoordinator,
      automationJobs,
      agentJobs,
      assistantRecords,
      onError,
      locale,
    } as any);
  }

  platformPlugin: FeishuPlatformPlugin;
  bridgeRuntime: WeixinBridgeRuntime;

  async start(): Promise<void> {
    this.platformPlugin.setInboundHandler(async (event) => {
      await this.bridgeRuntime.dispatchInboundEvent(event);
    });
    this.bridgeRuntime.automationJobs?.resetRunningJobs?.();
    if (typeof this.bridgeRuntime.agentJobs?.recoverSupervisableMissions === 'function') {
      this.bridgeRuntime.agentJobs.recoverSupervisableMissions();
    } else {
      this.bridgeRuntime.agentJobs?.resetRunningJobs?.();
    }
    this.bridgeRuntime.startAutomationScheduler();
    this.bridgeRuntime.startInternalThreadCleanupScheduler();
    await this.platformPlugin.start();
  }

  async stop(): Promise<void> {
    this.platformPlugin.setInboundHandler(null);
    this.bridgeRuntime.stopAutomationScheduler();
    this.bridgeRuntime.stopInternalThreadCleanupScheduler();
    await this.bridgeRuntime.flushAllPendingInboundMerges();
    await this.bridgeRuntime.waitForIdle();
    await this.platformPlugin.stop();
  }
}
