# octo for VS Code

Chat with [octo](https://github.com/open-octo/octo-agent) — the open-source, MIT-licensed, self-hosted AI coding agent — right inside VS Code.

This extension is a thin client: it connects to a local `octo serve` process over WebSocket and REST. All the actual agent work (LLM calls, tool execution, session state) happens in `octo serve`; the extension just gives you the chat and your session list in your editor.

## Features

- **Chat in the sidebar** — the conversation lives in the octo Activity Bar container, next to the session list, so it never costs you an editor tab.
- **Your workspace is the project** — the first session in a folder creates (or joins) an octo project that mounts it, so the agent's tools, memory and `.octorules` are scoped to the code you're actually looking at.
- **Session list** — every session in this workspace's project, newest first, badged when one is waiting on you; rename or delete from the list.
- **Session header** — which session you're in, how full its context window is, and what permission mode its tools run under.
- **Task checklist** — the agent's plan, pinned above the composer and ticked off as it goes.
- **Reasoning, folded away** — the thinking trace sits collapsed above the reply it belongs to.
- **Slash commands** — type `/` for octo's built-ins (`/clear`, `/compact`, `/reload`, `/goal`, `/loop`) and your installed skills.
- **Automatic context** — the file you currently have open (or your selection, plus any diagnostics on it) is attached to your next message automatically. Attach additional files with the attach button, or paste an image straight into the composer.
- **Native diff view** — file edits the agent makes open in VS Code's own diff viewer, not a text dump in the chat.
- **Permission and question prompts** — confirmations and clarifying questions from the agent show up as native-feeling modals.
- **Auto-starts `octo serve`** — if nothing is listening on the configured host/port, the extension spawns `octo serve -d` for you.

## Requirements

- The [`octo`](https://github.com/open-octo/octo-agent) binary installed and on your `PATH` (or point `octo.binaryPath` at it).
- If you'd rather manage the server yourself, start `octo serve` before opening VS Code and the extension will attach to it instead of spawning a new one.

## Getting started

1. Install the extension and install `octo` if you haven't already.
2. Click the octo icon in the Activity Bar.
3. Click **New Session** (or open an existing session from the list).
4. Type a message. Whatever file you have open is sent along as context automatically.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `octo.host` | `127.0.0.1` | Host `octo serve` binds to. |
| `octo.port` | `8088` | Port `octo serve` listens on. |
| `octo.accessKey` | *(empty)* | Access key for a non-loopback `octo serve`. Not needed for the default local connection. |
| `octo.autoStart` | `true` | Spawn `octo serve -d` automatically when no server is found at `octo.host`:`octo.port`. |
| `octo.binaryPath` | `octo` | Path to the `octo` binary, or a bare name resolved from `PATH` and common install locations. |

## License

MIT — see [LICENSE.txt](LICENSE.txt).
