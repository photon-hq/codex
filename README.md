# Codex on iMessage

A coding agent that helps you build and ship with AI — powered by ChatGPT, now on iMessage.

## How it works

1. Paste your OpenAI API key
2. Connect Spectrum and get a phone number
3. Open iMessage with the number and start chatting

Codex replies in the same thread. Send `/new` any time to start a fresh conversation.

## Commands

| Message                  | What it does                                            |
| ------------------------ | ------------------------------------------------------- |
| _anything_               | Asks Codex. Stateful — follow-ups remember the context. |
| `/new`                   | Resets the conversation. Bot reacts with 👌 to confirm. |

## Privacy

- Your OpenAI API key is AES-256-GCM encrypted at rest. Plaintext only exists in memory
  while a message is being answered.
- Messages go directly to OpenAI's Responses API — nothing is shared with third parties.
- Revoke your key on the OpenAI dashboard any time; the bot will stop replying until you
  rotate it.

## License

MIT.
