# Changelog

## 0.1.8

- Claude can look at your dashboards. A new `ha_screenshot` tool opens a
  frontend page (for example `/lovelace/kitchen`) in a headless browser inside
  the add-on and hands Claude a screenshot, together with the exact error
  behind every error card ("Custom element doesn't exist: button-card",
  "Entity not found: light.x", with the card and entity it belongs to).
  Claude uses it to verify dashboard changes, on desktop and phone sizes, in
  light or dark mode. Screenshots also appear in the chat.
- Opt-in: create a long-lived access token in your Home Assistant profile and
  paste it into the new "Dashboard access token" option. The token stays in
  the add-on server process; Claude only sees the screenshots.
- Chromium starts only when a screenshot is taken and exits after 90 seconds
  idle, so it uses no memory the rest of the time. The image is larger now
  because it includes Chromium.

## 0.1.7

- Attach screenshots and files to a message: paste a screenshot straight into
  the message box, drag and drop files onto it, or pick them with the paperclip
  button. Images (PNG, JPEG, GIF, WebP) and PDFs are shown to Claude directly;
  text files (YAML, logs, JSON, ...) are included as text. Attachments appear
  as thumbnails in the chat and are removed when the chat is deleted.
- Validate YAML before Home Assistant's config check: the image now ships
  Python, PyYAML and yamllint, plus an `ha-yaml-check` command that parses
  files like Home Assistant does (understands `!include`, `!include_dir_*`,
  `!secret`, `!env_var`, `!input`) and reports syntax errors, duplicate keys,
  missing include targets and unknown `!secret` names with file:line:column,
  without ever printing secret values. `--lint` adds yamllint style checks
  with HA-friendly defaults. Claude runs it after every YAML edit; plain
  validator runs inside /config are auto-approved when
  `auto_approve_readonly_tools` is on.

## 0.1.6

- Syntax-highlight YAML (and JSON/INI/etc.) in the file-edit diff view, on top of
  the red/green diff.
- Fix the aarch64 image build: runtime dependencies are now cross-installed on
  the build host instead of under QEMU emulation, which was crashing (SIGILL).

## 0.1.5

- Render Claude's replies as Markdown, with syntax-highlighted code blocks.
- Add an add-on icon and logo.
- Add in-app documentation (Documentation tab).
- Install prebuilt multi-arch images from ghcr.io instead of building on-device.

## 0.1.4

- Show file changes as a red/green diff. Edit, Write and MultiEdit now render a
  GitHub-style diff (with +/- line counts) instead of a raw JSON tool card.

## 0.1.3

- Show Claude's reasoning: a summary of the model's thinking now streams into a
  "Thinking" panel above each answer (auto-expands while it thinks, then stays
  collapsible). Only the summary is shown, never the raw chain of thought, and
  the model still decides when deeper reasoning is warranted.

## 0.1.2

- Security: the model's subprocess no longer receives the Supervisor token, and
  the add-on's private `/data` directory (credentials, sessions, audit log) plus
  credential environment variables are blocked from all tools. This prevents a
  shell command from reading tokens and calling the Supervisor API directly,
  bypassing the tool guards.
- Add a GitHub Actions workflow that builds and publishes multi-arch images, so
  installs can use a prebuilt image instead of building on-device.

## 0.1.1

- Fix: the Home Assistant tools (states, services, config check, reload, …) are
  now actually available to Claude. A tool-schema issue previously caused the
  `ha` MCP server to expose no tools, so Claude reported it couldn't query your
  entities.
- Tools now load directly (no tool-search step) and are referenced by their real
  names, so Claude uses them without prompting to "reconnect".
- A fresh tool connection is created per chat, fixing intermittent failures in
  the second and later chats of a session.

## 0.1.0

- Initial release: Claude chat panel in the Home Assistant sidebar.
- Read, edit and validate your configuration with the standard Claude Code file
  tools plus Home Assistant tools (states, services, areas/devices, logs,
  templates, config check, reload, guarded restart).
- Subscription sign-in with `claude setup-token`, or a static API key.
- Per-chat permission modes and model selection, interactive multiple-choice
  questions, secrets guard, config check before reload/restart, git checkpoint
  and audit log.
