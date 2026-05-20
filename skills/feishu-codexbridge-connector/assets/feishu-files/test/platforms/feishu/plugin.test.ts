import assert from 'node:assert/strict';
import test from 'node:test';
import { FeishuPlatformPlugin } from '../../../src/platforms/feishu/plugin.js';

test('FeishuPlatformPlugin normalizes incoming text messages', () => {
  const plugin = new FeishuPlatformPlugin();

  const event = plugin.normalizeInboundEvent({
    event: {
      sender: {
        sender_id: {
          open_id: 'ou_sender',
        },
      },
      message: {
        chat_id: 'oc_chat',
        chat_type: 'p2p',
        message_id: 'om_msg',
        message_type: 'text',
        content: JSON.stringify({ text: '<at user_id="ou_bot">Bot</at> hello from feishu' }),
      },
    },
  });

  const metadata = event?.metadata as Record<string, any> | undefined;
  assert.equal(event?.platform, 'feishu');
  assert.equal(event?.externalScopeId, 'oc_chat');
  assert.equal(event?.text, 'hello from feishu');
  assert.equal(metadata?.feishu?.messageId, 'om_msg');
  assert.equal(metadata?.feishu?.senderId, 'ou_sender');
});

test('FeishuPlatformPlugin enforces chat and user allowlists', () => {
  const plugin = new FeishuPlatformPlugin({
    allowedChats: ['oc_allowed'],
    allowedUsers: ['ou_allowed'],
  });

  const blocked = plugin.normalizeInboundEvent({
    event: {
      sender: { sender_id: { open_id: 'ou_blocked' } },
      message: {
        chat_id: 'oc_allowed',
        message_type: 'text',
        content: JSON.stringify({ text: 'blocked' }),
      },
    },
  });
  const allowed = plugin.normalizeInboundEvent({
    event: {
      sender: { sender_id: { open_id: 'ou_allowed' } },
      message: {
        chat_id: 'oc_allowed',
        message_type: 'text',
        content: JSON.stringify({ text: 'allowed' }),
      },
    },
  });

  assert.equal(blocked, null);
  assert.equal(allowed?.text, 'allowed');
});

test('FeishuPlatformPlugin builds text delivery payloads', () => {
  const plugin = new FeishuPlatformPlugin();

  const deliveries = plugin.buildTextDeliveries({
    externalScopeId: 'oc_chat',
    content: 'reply from bridge',
  });

  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0], {
    kind: 'feishu.im.message.create',
    payload: {
      receive_id_type: 'chat_id',
      receive_id: 'oc_chat',
      msg_type: 'text',
      content: JSON.stringify({ text: 'reply from bridge' }),
    },
  });
});

test('FeishuPlatformPlugin sendText uses the injected client and reports success', async () => {
  const calls: any[] = [];
  const plugin = new FeishuPlatformPlugin({
    client: {
      im: {
        message: {
          async create(params) {
            calls.push(params);
            return { code: 0 };
          },
        },
      },
    },
  });

  const result = await plugin.sendText({
    externalScopeId: 'oc_chat',
    content: 'reply from bridge',
  });

  assert.equal(result.success, true);
  assert.equal(result.deliveredCount, 1);
  assert.deepEqual(calls, [{
    params: {
      receive_id_type: 'chat_id',
    },
    data: {
      receive_id: 'oc_chat',
      msg_type: 'text',
      content: JSON.stringify({ text: 'reply from bridge' }),
    },
  }]);
});

test('FeishuPlatformPlugin start wires websocket events into the inbound handler', async () => {
  const received: any[] = [];
  let dispatcher: any = null;
  const plugin = new FeishuPlatformPlugin({
    client: {},
    wsClient: {
      start(params) {
        dispatcher = params.eventDispatcher;
      },
    },
    createEventDispatcher(handlers) {
      return handlers;
    },
  });
  plugin.setInboundHandler((event) => {
    received.push(event);
  });

  await plugin.start();
  await dispatcher['im.message.receive_v1']({
    event: {
      message: {
        chat_id: 'oc_chat',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
      },
    },
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].externalScopeId, 'oc_chat');
  assert.equal(received[0].text, 'hello');
});
