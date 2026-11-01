'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const {
  listChats,
  loadChat,
  createChat,
  updateChatMeta,
  appendMessage,
  deleteChat
} = require('../../server/store/chatStore');

test('listChats: returns [] when chats.json does not exist', (t) => {
  const dir = mkTmpDir('chats');
  t.after(() => rmTmpDir(dir));
  assert.deepEqual(listChats(dir), []);
});

test('createChat: persists a chat with a generated id, default title, and no messages', (t) => {
  const dir = mkTmpDir('chats');
  t.after(() => rmTmpDir(dir));

  const chat = createChat(dir);
  assert.equal(chat.title, 'Nuevo chat');
  assert.equal(chat.claudeSessionId, null);
  assert.deepEqual(chat.messages, []);

  const listed = listChats(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, chat.id);
  assert.equal(listed[0].messages, undefined); // list is metadata-only
});

test('loadChat: returns the full chat including messages, or null when unknown', (t) => {
  const dir = mkTmpDir('chats');
  t.after(() => rmTmpDir(dir));

  const chat = createChat(dir, 'Mi chat');
  assert.equal(loadChat(dir, chat.id).title, 'Mi chat');
  assert.equal(loadChat(dir, 'does-not-exist'), null);
});

test('appendMessage: appends in order and bumps updatedAt', async (t) => {
  const dir = mkTmpDir('chats');
  t.after(() => rmTmpDir(dir));

  const chat = createChat(dir);
  await new Promise((resolve) => setTimeout(resolve, 5));
  appendMessage(dir, chat.id, { role: 'user', text: 'hola' });
  const updated = appendMessage(dir, chat.id, { role: 'claude_event', event: { type: 'result' } });

  assert.equal(updated.messages.length, 2);
  assert.equal(updated.messages[0].text, 'hola');
  assert.notEqual(updated.updatedAt, chat.updatedAt);
});

test('updateChatMeta: patches claudeSessionId without touching messages', (t) => {
  const dir = mkTmpDir('chats');
  t.after(() => rmTmpDir(dir));

  const chat = createChat(dir);
  appendMessage(dir, chat.id, { role: 'user', text: 'hola' });
  const updated = updateChatMeta(dir, chat.id, { claudeSessionId: 'abc-123' });

  assert.equal(updated.claudeSessionId, 'abc-123');
  assert.equal(updated.messages.length, 1);
});

test('deleteChat: removes the chat and reports whether it existed', (t) => {
  const dir = mkTmpDir('chats');
  t.after(() => rmTmpDir(dir));

  const chat = createChat(dir);
  assert.equal(deleteChat(dir, chat.id), true);
  assert.equal(loadChat(dir, chat.id), null);
  assert.equal(deleteChat(dir, chat.id), false);
});
