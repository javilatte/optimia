'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function chatsPath(projectRoot) {
  return path.join(projectRoot, '.optimia', 'chats.json');
}

function loadChats(projectRoot) {
  const file = chatsPath(projectRoot);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveChats(projectRoot, chats) {
  const dir = path.join(projectRoot, '.optimia');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(chatsPath(projectRoot), JSON.stringify(chats, null, 2) + '\n');
}

// Metadata only (no messages) — cheap to list without loading every transcript.
function listChats(projectRoot) {
  return loadChats(projectRoot)
    .map(({ messages, ...meta }) => meta)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function loadChat(projectRoot, chatId) {
  return loadChats(projectRoot).find((c) => c.id === chatId) || null;
}

function createChat(projectRoot, title) {
  const chats = loadChats(projectRoot);
  const now = new Date().toISOString();
  const chat = {
    id: crypto.randomUUID(),
    title: title || 'Nuevo chat',
    claudeSessionId: null,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  chats.push(chat);
  saveChats(projectRoot, chats);
  return chat;
}

function updateChatMeta(projectRoot, chatId, patch) {
  const chats = loadChats(projectRoot);
  const idx = chats.findIndex((c) => c.id === chatId);
  if (idx === -1) return null;
  chats[idx] = { ...chats[idx], ...patch, updatedAt: new Date().toISOString() };
  saveChats(projectRoot, chats);
  return chats[idx];
}

function appendMessage(projectRoot, chatId, message) {
  const chats = loadChats(projectRoot);
  const idx = chats.findIndex((c) => c.id === chatId);
  if (idx === -1) return null;
  chats[idx].messages.push(message);
  chats[idx].updatedAt = new Date().toISOString();
  saveChats(projectRoot, chats);
  return chats[idx];
}

function deleteChat(projectRoot, chatId) {
  const chats = loadChats(projectRoot);
  const next = chats.filter((c) => c.id !== chatId);
  if (next.length === chats.length) return false;
  saveChats(projectRoot, next);
  return true;
}

module.exports = {
  chatsPath,
  loadChats,
  listChats,
  loadChat,
  createChat,
  updateChatMeta,
  appendMessage,
  deleteChat
};
