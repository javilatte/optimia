# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-10-31

Reescritura completa del flujo de optimia. Cambio incompatible con versiones anteriores.

### Added
- Interfaz web local: `optimia` arranca un servidor Node (HTTP + WebSocket) y abre el navegador en vez de lanzar un wizard de terminal.
- Chat en vivo contra un proceso `claude` CLI real (long-lived, NDJSON por WebSocket), con soporte de multi-turno dentro de la misma sesión.
- Puente de IA local vía Ollama (endpoint `/v1/messages` compatible con la Anthropic Messages API).
- Soporte de imágenes/capturas en el chat (paste y drag-and-drop), enviadas como bloques de imagen inline al proceso `claude`.
- Panel de Settings en la web: modelo/effort de Claude, IA local, Instructions, Memory (`.optimia/memory.md`), No-go (patrones de `permissions.deny`), y gestión de Skills (`.claude/skills/`).
- Migración automática de las preferencias existentes de un proyecto (`.optimia/system-prompt.md`, `permissions.deny` de `.claude/settings.json`) a los nuevos campos de Settings, con vista previa antes de aplicar.
- Panel kanban de tareas para agentes de codificación, con worktrees de git por tarea.
- `bin/optimia` reescrito como launcher Node delgado: crea `.optimia/`, ofrece activar/inicializar/sincronizar CodeGraph, y arranca el servidor.

### Removed
- Soporte para opencode, Gemini CLI, GitHub Copilot CLI y `headroom`. Solo quedan **Claude Code** e **IA local** (Ollama).
- El wizard interactivo de preguntas al arrancar (`ask_quick_questions`) y los subcomandos `tools`/`config`/`repos`/`agents` de la CLI — la configuración ahora vive en la interfaz web.
- `openwiki` y la generación de `AGENTS.md`/`GEMINI.md`/`security.md` para otras herramientas.

### Changed
- `optimia` ya no usa la API de Claude directamente: siempre orquesta el CLI real `claude` como subproceso.
