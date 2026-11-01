'use strict';

const fs = require('fs');
const path = require('path');
const { loadSettings, saveSettings } = require('../store/settingsStore');
const { claudeSettingsPath, syncClaudeSettings } = require('../bridge/claudeSettingsSync');

/**
 * One-shot importer for the old per-project defaults (system-prompt.md,
 * security.md, the generated .claude/settings.json) into the new
 * settings.json preferences. Read-only: never writes until applyMigration
 * is explicitly called, so the Settings UI (Fase 8) can show a diff first.
 */
function readLegacyDefaults(projectRoot) {
  const optimiaDir = path.join(projectRoot, '.optimia');
  const systemPromptFile = path.join(optimiaDir, 'system-prompt.md');
  const securityFile = path.join(optimiaDir, 'security.md');
  const claudeFile = claudeSettingsPath(projectRoot);

  const instructions = fs.existsSync(systemPromptFile)
    ? fs.readFileSync(systemPromptFile, 'utf8')
    : null;

  let noGo = null;
  let noGoSource = null;
  let securityFoundButNotParsed = false;

  if (fs.existsSync(claudeFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(claudeFile, 'utf8'));
      if (Array.isArray(parsed.permissions?.deny)) {
        noGo = parsed.permissions.deny;
        noGoSource = '.claude/settings.json';
      }
    } catch { /* leave noGo null, nothing reliable to import */ }
  }
  if (noGo === null && fs.existsSync(securityFile)) {
    // security.md is prose, not a structured deny list — auto-parsing it
    // would be guesswork, so it's flagged for the user instead of migrated.
    securityFoundButNotParsed = true;
  }

  return {
    instructions,
    noGo,
    sources: {
      instructions: instructions !== null ? systemPromptFile : null,
      noGo: noGoSource,
      securityFoundButNotParsed
    }
  };
}

function buildMigrationPreview(projectRoot) {
  const current = loadSettings(projectRoot);
  const legacy = readLegacyDefaults(projectRoot);
  return {
    instructions: {
      current: current.preferences.instructions,
      proposed: legacy.instructions,
      changed: legacy.instructions !== null && legacy.instructions !== current.preferences.instructions
    },
    noGo: {
      current: current.preferences.noGo,
      proposed: legacy.noGo,
      changed: legacy.noGo !== null && JSON.stringify(legacy.noGo) !== JSON.stringify(current.preferences.noGo)
    },
    sources: legacy.sources
  };
}

function applyMigration(projectRoot) {
  const preview = buildMigrationPreview(projectRoot);
  const current = loadSettings(projectRoot);
  const next = {
    ...current,
    preferences: {
      ...current.preferences,
      instructions: preview.instructions.changed ? preview.instructions.proposed : current.preferences.instructions,
      noGo: preview.noGo.changed ? preview.noGo.proposed : current.preferences.noGo
    }
  };
  saveSettings(projectRoot, next);
  syncClaudeSettings(projectRoot, next.preferences.noGo);
  return next;
}

module.exports = { readLegacyDefaults, buildMigrationPreview, applyMigration };
