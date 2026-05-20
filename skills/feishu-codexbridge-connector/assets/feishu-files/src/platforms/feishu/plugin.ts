import * as lark from '@larksuiteoapi/node-sdk';
import type {
  InboundTextEvent,
  PlatformDeliveryRequest,
  PlatformPluginContract,
  PlatformTextDeliveryResult,
} from '../../types/platform.js';

interface FeishuClientLike {
  im?: {
    message?: {
      create?(params: {
        params: { receive_id_type: 'chat_id' };
        data: {
          receive_id: string;
          msg_type: 'text';
          content: string;
        };
      }): Promise<unknown> | unknown;
    };
  };
}

interface FeishuWsClientLike {
  start?(params: { eventDispatcher: unknown }): Promise<void> | void;
  stop?(): Promise<void> | void;
  close?(): Promise<void> | void;
  agent?: {
    destroy?(): void;
  } | null;
  httpInstance?: {
    defaults?: {
      httpAgent?: { destroy?(): void } | null;
      httpsAgent?: { destroy?(): void } | null;
    } | null;
  } | null;
}

interface FeishuPlatformPluginOptions {
  appId?: string | null;
  appSecret?: string | null;
  verificationToken?: string | null;
  encryptKey?: string | null;
  allowedChats?: string[] | null;
  allowedUsers?: string[] | null;
  client?: FeishuClientLike | null;
  wsClient?: FeishuWsClientLike | null;
  createEventDispatcher?: ((handlers: Record<string, (event: unknown) => Promise<void>>) => unknown) | null;
}

interface FeishuNormalizedMessage {
  externalScopeId: string;
  text: string;
  metadata: Record<string, unknown>;
}

type FeishuInboundHandler = (event: InboundTextEvent) => Promise<void> | void;

export class FeishuPlatformPlugin implements PlatformPluginContract {
  constructor({
    appId = process.env.FEISHU_APP_ID ?? null,
    appSecret = process.env.FEISHU_APP_SECRET ?? null,
    verificationToken = process.env.FEISHU_VERIFICATION_TOKEN ?? null,
    encryptKey = process.env.FEISHU_ENCRYPT_KEY ?? null,
    allowedChats = parseCsvEnv(process.env.FEISHU_ALLOWED_CHATS),
    allowedUsers = parseCsvEnv(process.env.FEISHU_ALLOWED_USERS),
    client = null,
    wsClient = null,
    createEventDispatcher = null,
  }: FeishuPlatformPluginOptions = {}) {
    this.id = 'feishu';
    this.displayName = 'Feishu';
    this.appId = normalizeString(appId);
    this.appSecret = normalizeString(appSecret);
    this.verificationToken = normalizeString(verificationToken);
    this.encryptKey = normalizeString(encryptKey);
    this.allowedChats = new Set((allowedChats ?? []).map((item) => item.trim()).filter(Boolean));
    this.allowedUsers = new Set((allowedUsers ?? []).map((item) => item.trim()).filter(Boolean));
    this.client = client;
    this.wsClient = wsClient;
    this.createEventDispatcher = createEventDispatcher;
    this.inboundHandler = null;
  }

  id: string;
  displayName: string;
  appId: string | null;
  appSecret: string | null;
  verificationToken: string | null;
  encryptKey: string | null;
  allowedChats: Set<string>;
  allowedUsers: Set<string>;
  client: FeishuClientLike | null;
  wsClient: FeishuWsClientLike | null;
  createEventDispatcher: ((handlers: Record<string, (event: unknown) => Promise<void>>) => unknown) | null;
  inboundHandler: FeishuInboundHandler | null;

  setInboundHandler(handler: FeishuInboundHandler | null): void {
    this.inboundHandler = handler;
  }

  async start(): Promise<void> {
    this.ensureClients();
    const eventDispatcher = this.buildEventDispatcher();
    await this.wsClient?.start?.({ eventDispatcher });
  }

  async stop(): Promise<void> {
    const stopPromise = this.wsClient?.close?.() ?? this.wsClient?.stop?.();
    if (stopPromise && typeof (stopPromise as Promise<void>).then === 'function') {
      await Promise.race([
        stopPromise,
        sleep(3000),
      ]);
    }
    this.wsClient?.agent?.destroy?.();
    this.wsClient?.httpInstance?.defaults?.httpAgent?.destroy?.();
    this.wsClient?.httpInstance?.defaults?.httpsAgent?.destroy?.();
  }

  normalizeInboundEvent(payload: Record<string, unknown>): InboundTextEvent | null {
    const normalized = normalizeFeishuMessage(payload);
    if (!normalized) {
      return null;
    }
    const feishu = getObject(normalized.metadata.feishu);
    const chatId = normalizeText(feishu?.chatId);
    const senderId = normalizeText(feishu?.senderId);
    if (this.allowedChats.size > 0 && (!chatId || !this.allowedChats.has(chatId))) {
      return null;
    }
    if (this.allowedUsers.size > 0 && (!senderId || !this.allowedUsers.has(senderId))) {
      return null;
    }
    return {
      platform: 'feishu',
      externalScopeId: normalized.externalScopeId,
      text: normalized.text,
      attachments: [],
      locale: null,
      metadata: normalized.metadata,
    };
  }

  buildTextDeliveries({
    externalScopeId,
    content,
  }: {
    externalScopeId: string;
    content: string;
  }): PlatformDeliveryRequest[] {
    return splitFeishuText(content).map((text) => ({
      kind: 'feishu.im.message.create',
      payload: {
        receive_id_type: 'chat_id',
        receive_id: externalScopeId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    }));
  }

  async sendText({
    externalScopeId,
    content,
  }: {
    externalScopeId: string;
    content: string;
  }): Promise<PlatformTextDeliveryResult> {
    const deliveries = this.buildTextDeliveries({ externalScopeId, content });
    const deliveredTexts: string[] = [];
    for (let index = 0; index < deliveries.length; index += 1) {
      const payload = deliveries[index]?.payload ?? {};
      const text = parseFeishuDeliveryText(payload.content);
      if (!this.client?.im?.message?.create) {
        deliveredTexts.push(text);
        continue;
      }
      try {
        const result = await this.client.im.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: String(payload.receive_id ?? ''),
            msg_type: 'text',
            content: String(payload.content ?? ''),
          },
        });
        const failure = getFeishuSendFailure(result);
        if (failure) {
          return buildSendFailure(deliveredTexts, index, text, failure.message, failure.code);
        }
        deliveredTexts.push(text);
      } catch (error) {
        return buildSendFailure(
          deliveredTexts,
          index,
          text,
          error instanceof Error ? error.message : String(error),
          null,
        );
      }
    }
    return {
      success: true,
      deliveredCount: deliveredTexts.length,
      deliveredText: deliveredTexts.join('\n\n'),
      failedIndex: null,
      failedText: '',
      error: '',
    };
  }

  async sendTyping(): Promise<void> {
    // Feishu's bot message API has no stable cross-chat typing indicator equivalent.
  }

  private ensureClients(): void {
    if (this.client && this.wsClient) {
      return;
    }
    if (!this.appId || !this.appSecret) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required.');
    }
    const config = {
      appId: this.appId,
      appSecret: this.appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.info,
    };
    this.client ??= new lark.Client(config) as FeishuClientLike;
    this.wsClient ??= new lark.WSClient({
      ...config,
      autoReconnect: true,
    }) as unknown as FeishuWsClientLike;
  }

  private buildEventDispatcher(): unknown {
    const handlers = {
      'im.message.receive_v1': async (event: unknown) => {
        const normalized = await this.normalizeInboundEvent(asRecord(event));
        if (!normalized) {
          return;
        }
        await this.inboundHandler?.(normalized);
      },
    };
    if (this.createEventDispatcher) {
      return this.createEventDispatcher(handlers);
    }
    return new lark.EventDispatcher({
      verificationToken: this.verificationToken ?? undefined,
      encryptKey: this.encryptKey ?? undefined,
    }).register(handlers);
  }
}

function normalizeFeishuMessage(payload: Record<string, unknown>): FeishuNormalizedMessage | null {
  const event = getObject(payload.event) ?? payload;
  const message = getObject(event.message) ?? getObject(payload.message);
  if (!message) {
    return null;
  }
  const chatId = normalizeText(message.chat_id);
  if (!chatId) {
    return null;
  }
  const messageType = normalizeText(message.message_type);
  if (messageType && messageType !== 'text') {
    return null;
  }
  const text = cleanFeishuText(extractFeishuText(message.content));
  if (!text) {
    return null;
  }
  const sender = getObject(event.sender) ?? getObject(payload.sender);
  const senderId = normalizeText(getObject(sender?.sender_id)?.open_id)
    ?? normalizeText(getObject(sender?.sender_id)?.user_id)
    ?? normalizeText(getObject(sender?.sender_id)?.union_id);
  return {
    externalScopeId: chatId,
    text,
    metadata: {
      feishu: {
        chatId,
        chatType: normalizeText(message.chat_type),
        messageId: normalizeText(message.message_id),
        messageType: messageType || null,
        senderId,
      },
    },
  };
}

function extractFeishuText(content: unknown): string {
  if (typeof content !== 'string') {
    return '';
  }
  try {
    const parsed = JSON.parse(content);
    return typeof parsed?.text === 'string' ? parsed.text : content;
  } catch {
    return content;
  }
}

function cleanFeishuText(text: string): string {
  return String(text || '')
    .replace(/<at[^>]*>.*?<\/at>/gu, '')
    .replace(/@\S+/gu, '')
    .trim();
}

function splitFeishuText(content: string): string[] {
  const normalized = String(content ?? '').trim();
  if (!normalized) {
    return [''];
  }
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > 3500) {
    let boundary = remaining.lastIndexOf('\n', 3500);
    if (boundary < 800) {
      boundary = 3500;
    }
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  chunks.push(remaining);
  return chunks;
}

function parseFeishuDeliveryText(content: unknown): string {
  try {
    const parsed = JSON.parse(String(content ?? '{}'));
    return typeof parsed?.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

function getFeishuSendFailure(result: unknown): { message: string; code: number | null } | null {
  const record = getObject(result);
  if (!record) {
    return null;
  }
  const code = normalizeNumber(record.code);
  if (code !== null && code !== 0) {
    return {
      code,
      message: normalizeText(record.msg) ?? normalizeText(record.message) ?? 'feishu send failed',
    };
  }
  return null;
}

function buildSendFailure(
  deliveredTexts: string[],
  index: number,
  text: string,
  error: string,
  errorCode: number | null,
): PlatformTextDeliveryResult {
  return {
    success: false,
    deliveredCount: deliveredTexts.length,
    deliveredText: deliveredTexts.join('\n\n'),
    failedIndex: index,
    failedText: text,
    error,
    errorCode,
  };
}

function parseCsvEnv(value: unknown): string[] {
  return typeof value === 'string'
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: unknown): string | null {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return normalized || null;
}

function normalizeString(value: unknown): string | null {
  return normalizeText(value);
}

function normalizeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
