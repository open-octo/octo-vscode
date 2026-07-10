# octo for VS Code

Chat with [octo](https://github.com/open-octo/octo-agent) — the open-source, MIT-licensed, self-hosted AI coding agent — right inside VS Code.

This extension is a thin client: it connects to a local `octo serve` process over WebSocket and REST. All the actual agent work (LLM calls, tool execution, session state) happens in `octo serve`; the extension just gives you a chat panel and session list in your editor.

## Features

- **Session list in the Activity Bar** — every octo session for the current workspace, with the active one marked.
- **Chat panel beside your editor** — opens to the side (like a normal editor tab), not squeezed into the sidebar.
- **Automatic context** — the file you currently have open (or your selection, plus any diagnostics on it) is attached to your next message automatically. Attach additional files with the `@ file` button.
- **Native diff view** — file edits the agent makes open in VS Code's own diff viewer, not a text dump in the chat.
- **Permission and question prompts** — confirmations and clarifying questions from the agent show up as native-feeling modals in the panel.
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
