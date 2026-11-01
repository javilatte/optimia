'use strict';

const fs = require('fs');
const path = require('path');

function skillsDir(projectRoot) {
  return path.join(projectRoot, '.claude', 'skills');
}

// Lightweight frontmatter read, not a full YAML parser (this project has no
// YAML dependency) — good enough to show a name/description in a listing.
function readFrontmatterField(text, field) {
  const match = text.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^>-?$/, '').trim() : '';
}

function listSkills(projectRoot) {
  const dir = skillsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      let name = entry.name;
      let description = '';
      if (fs.existsSync(skillFile)) {
        const text = fs.readFileSync(skillFile, 'utf8');
        name = readFrontmatterField(text, 'name') || entry.name;
        description = readFrontmatterField(text, 'description');
      }
      return { slug: entry.name, name, description, hasSkillFile: fs.existsSync(skillFile) };
    });
}

function createSkill(projectRoot, slug, description) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('el nombre de la skill debe ser kebab-case (letras minusculas, numeros y guiones)');
  }
  const dir = path.join(skillsDir(projectRoot), slug);
  if (fs.existsSync(dir)) throw new Error(`ya existe una skill llamada "${slug}"`);
  fs.mkdirSync(dir, { recursive: true });
  const body = `---\nname: ${slug}\ndescription: ${description || 'TODO: describe cuando usar esta skill.'}\n---\n\n# ${slug}\n\nTODO: instrucciones de la skill.\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
  return { slug, name: slug, description: description || '', hasSkillFile: true };
}

module.exports = { skillsDir, listSkills, createSkill };
