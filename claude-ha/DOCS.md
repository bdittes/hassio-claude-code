# Claude for Home Assistant

Chat with Claude directly inside Home Assistant to read, explain, write and
validate your configuration. Claude works on your real `/config` directory with
the same file tools as Claude Code, plus a set of Home Assistant tools — and it
asks before it changes anything, refuses to read your secrets, and takes a git
checkpoint before its first edit so you can roll back.

## Requirements

- Home Assistant OS or Supervised (this runs as a Supervisor add-on).
- One of:
  - A **Claude subscription** (Pro, Max, Team or Enterprise) — recommended.
  - An **Anthropic API key** (usage-based billing).

## Authentication

Set `auth_method` in the **Configuration** tab.

### Subscription (recommended)

1. On any computer with [Claude Code](https://code.claude.com/) installed and
   signed in to your Claude account, run:

   ```bash
   claude setup-token
   ```

2. Approve the browser login. It prints a token valid for about a year.
3. Set `auth_method: oauth`, paste the token into `oauth_token`, and restart the
   add-on.

### API key

Set `auth_method: api_key` and paste your key into `anthropic_api_key`, then
restart. Usage is billed to your Anthropic account.

## Using it

Open **Claude** from the sidebar and type a request, for example:

- "List all my lights and which ones are on."
- "Create an automation that turns off all lights at 23:00 and validate the config."
- "Why isn't my `binary_sensor.front_door` automation firing? Check the logs."

**Permission modes** (bottom-left of the composer):

- **Ask every time** — Claude asks before every write, service call, reload or restart.
- **Auto-approve edits** — file edits run without asking; Home Assistant writes still ask.
- **Plan only** — Claude plans without changing anything.

You can also pick a **model** per chat, and file changes are shown as a
red/green **diff** before you approve them. When Claude needs to choose between
options it asks with a short multiple-choice card instead of a wall of text, and
a summary of its **reasoning** streams into a collapsible "Thinking" panel.

**Screenshots and files**: paste a screenshot into the message box, drag
files onto it, or use the paperclip button. Claude sees images (PNG, JPEG, GIF,
WebP, up to 5 MB each) and PDFs (up to 20 MB), and reads text files such as
YAML, logs and JSON (up to 1 MB). Up to 10 files per message. Uploads are
stored under the add-on's `/data/uploads` and deleted together with the chat.

**Dashboard screenshots** (optional): Claude can open your dashboards in a
headless browser inside the add-on to check that its changes render: cards
show up, entities have values, nothing shows an error card, and the layout works
on a phone. To turn it on:

1. In Home Assistant, open your profile (bottom left) → **Security** →
   **Long-lived access tokens** → **Create token**, and copy the token.
2. Paste it into the add-on option **Dashboard access token** and restart the
   add-on.

Then ask for example "Add a card for the garage door to the main dashboard and
check it looks right on mobile". The token has the rights of the user who
created it and only ever lives in the add-on's server process. Claude and its
shell never see it; Claude only sees the screenshots. The browser starts on
demand and exits after 90 seconds idle.

## Configuration options

| Option                        | Default  | Description                                                                                     |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `auth_method`                 | `oauth`  | `oauth` (subscription token) or `api_key`.                                                       |
| `oauth_token`                 | —        | Token from `claude setup-token` (when `auth_method: oauth`).                                     |
| `anthropic_api_key`           | —        | Anthropic API key (when `auth_method: api_key`).                                                |
| `model`                       | —        | Optional default model id/alias (e.g. `opus`, `sonnet`). Switchable per chat.                    |
| `anthropic_base_url`          | —        | Optional. Route requests through an Anthropic-compatible gateway.                               |
| `log_level`                   | `info`   | `debug`, `info`, `warning`, `error`.                                                            |
| `auto_approve_readonly_tools` | `true`   | Run read-only Home Assistant tools (states, services, areas, logs, templates, screenshots) and the offline YAML check without a prompt. |
| `dashboard_token`             | —        | Optional long-lived access token that enables dashboard screenshots.                            |
| `frontend_url`                | —        | Optional. Where the add-on reaches the frontend; detected automatically (`http(s)://homeassistant:8123`). |

## Safety

- **Secrets guard** — `secrets.yaml`, the auth store, the add-on's own `/data`
  (which holds your token) and credential environment variables are blocked from
  every tool. Claude can see secret *names* but never their values.
- **YAML check** — after editing, Claude runs `ha-yaml-check` on the changed
  files: a fast offline check that understands `!include`, `!secret` and the
  other Home Assistant tags and reports syntax errors, duplicate keys, missing
  include targets and unknown secret names with line numbers (never secret
  values). `yamllint` is also installed; put a `.yamllint` in `/config` to use
  your own rules. Home Assistant's own config check still runs afterwards.
- **Config check** — `Reload` and `Restart Core` run a configuration check first
  and refuse if it fails.
- **Git checkpoint** — before its first edit in a session, the add-on commits a
  checkpoint of `/config`, and you can revert it from the header.
- **Audit log** — every tool call is recorded (secrets redacted) under `/data`.
- The Supervisor token is never exposed to the model's shell.

## Troubleshooting

- **"Not signed in" banner** — no credential configured. Follow
  [Authentication](#authentication) and restart the add-on.
- **A tool call fails** — check the add-on **Log**; set `log_level: debug` for
  detail. The startup log shows `mcp=ha:connected` when the Home Assistant tools
  are ready.
- **Nothing happens on send** — usually a missing or expired token. Re-run
  `claude setup-token` and update the option.
