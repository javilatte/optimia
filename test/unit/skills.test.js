'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { listSkills, createSkill, skillsDir } = require('../../server/bridge/skills');

test('listSkills: returns [] when .claude/skills/ does not exist', (t) => {
  const dir = mkTmpDir('skills');
  t.after(() => rmTmpDir(dir));
  assert.deepEqual(listSkills(dir), []);
});

test('createSkill: writes a SKILL.md with frontmatter, and listSkills reads name/description back', (t) => {
  const dir = mkTmpDir('skills');
  t.after(() => rmTmpDir(dir));

  const created = createSkill(dir, 'mi-skill', 'Hace cosas utiles');
  assert.equal(created.slug, 'mi-skill');
  assert.equal(fs.existsSync(path.join(skillsDir(dir), 'mi-skill', 'SKILL.md')), true);

  const listed = listSkills(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].slug, 'mi-skill');
  assert.equal(listed[0].name, 'mi-skill');
  assert.equal(listed[0].description, 'Hace cosas utiles');
  assert.equal(listed[0].hasSkillFile, true);
});

test('createSkill: rejects non-kebab-case slugs', (t) => {
  const dir = mkTmpDir('skills');
  t.after(() => rmTmpDir(dir));
  assert.throws(() => createSkill(dir, 'Not Kebab Case', 'x'), /kebab-case/);
});

test('createSkill: rejects a slug that already exists', (t) => {
  const dir = mkTmpDir('skills');
  t.after(() => rmTmpDir(dir));
  createSkill(dir, 'dup', 'first');
  assert.throws(() => createSkill(dir, 'dup', 'second'), /ya existe/);
});

test('listSkills: a directory without SKILL.md falls back to the folder name as slug/name', (t) => {
  const dir = mkTmpDir('skills');
  t.after(() => rmTmpDir(dir));
  fs.mkdirSync(path.join(skillsDir(dir), 'bare-folder'), { recursive: true });

  const listed = listSkills(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].slug, 'bare-folder');
  assert.equal(listed[0].name, 'bare-folder');
  assert.equal(listed[0].hasSkillFile, false);
});
