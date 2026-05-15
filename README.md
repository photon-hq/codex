# Codex on iMessage

Text Codex like you'd text a teammate. Replies come back in the same thread,
PRs included.

## How it works

1. Sign in to ChatGPT (the same account that has Codex)
2. Connect Spectrum and claim a phone number
3. Open iMessage with that number — Codex replies inline

## Commands

| Message                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| _anything_             | Asks Codex. Threads are stateful — follow-ups remember.   |
| `/help`                | Lists every command.                                      |
| `/new`                 | Starts a fresh Codex thread. 👍 tapback to confirm.       |
| `/branch`              | Shows the branch Codex runs against.                      |
| `/branch <name>`       | Switches branch and starts a fresh thread.                |
| `/switch`              | Lists your environments (repo + label).                   |
| `/switch <label-or-id>`| Picks an environment and starts a fresh thread.           |
| `/model`               | Shows the active model and a link to the chatgpt.com picker. |

Every message you send gets a 👍 tapback when Codex picks it up, and the
tapback flips to ❤️ when the task is finished.

## Privacy

- ChatGPT OAuth tokens are AES-256-GCM encrypted at rest. Plaintext lives in
  memory only while a request is in flight.
- Messages flow to OpenAI Codex through your authenticated ChatGPT session —
  nothing is shared with third parties.
- Disconnect any time from the dashboard. Codex stops replying immediately
  and the encrypted tokens are wiped.

## License

MIT.
