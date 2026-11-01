'use strict';

const fs = require('fs');
const path = require('path');

function settingsPath(projectRoot) {
  return path.join(projectRoot, '.optimia', 'settings.json');
}

const THEMES = ['system', 'light', 'dark'];
const CLOCKS = ['datetime', 'time'];

function defaultSettings() {
  return {
    ui: { theme: 'system', clock: 'datetime' },
    ai: {
      mode: 'claude', // 'claude' | 'local'
      claude: { model: 'default', effort: 'high' },
      localAi: { url: '', model: '', authHeader: '' }
    },
    preferences: {
      instructions: '',
      // array of .claude/settings.json deny patterns, e.g. "Read(**/.env*)",
      // "Bash(rm -rf *)" — synced 1:1 into permissions.deny (see
      // server/bridge/claudeSettingsSync.js). Same syntax, no translation.
      noGo: [],
      // Permisos que el usuario aprobo desde una tarjeta de tarea (ver
      // approvalRule en taskStages.js). Se suman a las herramientas de cada etapa.
      approvedTools: []
    }
  };
}

function loadSettings(projectRoot) {
  const file = settingsPath(projectRoot);
  if (!fs.existsSync(file)) return defaultSettings();
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const defaults = defaultSettings();
  return {
    ui: {
      theme: THEMES.includes(onDisk.ui?.theme) ? onDisk.ui.theme : defaults.ui.theme,
      clock: CLOCKS.includes(onDisk.ui?.clock) ? onDisk.ui.clock : defaults.ui.clock
    },
    ai: { ...defaults.ai, ...onDisk.ai, claude: { ...defaults.ai.claude, ...onDisk.ai?.claude }, localAi: { ...defaults.ai.localAi, ...onDisk.ai?.localAi } },
    preferences: {
      ...defaults.preferences,
      ...onDisk.preferences,
      noGo: Array.isArray(onDisk.preferences?.noGo) ? onDisk.preferences.noGo : defaults.preferences.noGo,
      approvedTools: Array.isArray(onDisk.preferences?.approvedTools) ? onDisk.preferences.approvedTools : []
    }
  };
}

function saveSettings(projectRoot, settings) {
  const dir = path.join(projectRoot, '.optimia');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(projectRoot), JSON.stringify(settings, null, 2) + '\n');
}

module.exports = { settingsPath, defaultSettings, loadSettings, saveSettings };
