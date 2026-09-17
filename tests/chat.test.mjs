import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  InGameChatBus,
  MAX_CHAT_MESSAGE_LENGTH,
  isValidInGameChatMessage,
  normalizeChatText,
} = require('../node_modules/.cache/alden-test/match/chat.js');

test('chat normalization removes control/newline noise and enforces the message limit', () => {
  const normalized = normalizeChatText(`  hola\n\t equipo ${'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 40)}  `);
  assert.equal(normalized.includes('\n'), false);
  assert.equal(normalized.includes('\t'), false);
  assert.ok(normalized.startsWith('hola equipo '));
  assert.ok(normalized.length <= MAX_CHAT_MESSAGE_LENGTH);
});

test('chat message contract validates network-relevant fields', () => {
  const valid = {
    messageId: 'm1',
    playerId: 'p1',
    team: 'blue',
    channel: 'team',
    text: 'hola',
    atMs: 1200,
  };
  assert.equal(isValidInGameChatMessage(valid), true);
  assert.equal(isValidInGameChatMessage({ ...valid, text: '  hola  ' }), false);
  assert.equal(isValidInGameChatMessage({ ...valid, channel: 'party' }), false);
});

test('InGameChatBus delivers messages and unsubscribe removes the listener', () => {
  const bus = new InGameChatBus();
  const received = [];
  const unsubscribe = bus.subscribe(message => received.push(message.messageId));
  const message = {
    messageId: 'm2',
    playerId: 'p2',
    team: 'red',
    channel: 'all',
    text: 'gg',
    atMs: 5000,
  };
  bus.publish(message);
  unsubscribe();
  bus.publish(message);
  assert.deepEqual(received, ['m2']);
  assert.equal(bus.listenerCount(), 0);
});
