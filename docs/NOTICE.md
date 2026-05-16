# Notice

Codex on iMessage is an independent, unofficial bridge built by
[Photon](https://photon.codes). It is **not affiliated with, endorsed by, or
sponsored by OpenAI, OpenCommerce OpCo, Apple, or any of their subsidiaries.**

## Trademarks

The following names, logos, and marks are the property of their respective
owners. Their use in this project is purely descriptive — to identify the
upstream services this bridge talks to — and does not imply any affiliation,
endorsement, or partnership.

- **ChatGPT®**, **Codex**, and the ChatGPT / Codex logos are trademarks of
  OpenAI OpCo, LLC. See [openai.com/policies/brand-guidelines](https://openai.com/policies/brand-guidelines/).
- **iMessage®**, **Messages**, **iPhone**, **macOS**, and **Apple** are
  trademarks of Apple Inc., registered in the U.S. and other countries.
- All other trademarks are the property of their respective owners.

This project does not redistribute, embed, or rehost any OpenAI or Apple
artwork. The Codex glyph used in the UI is a generic icon and not the
official Codex mark. We will remove any asset on request from the rightful
owner.

## What this project is

A user-installed convenience layer that:

1. Takes the **user's own** ChatGPT account credentials (via OpenAI's
   public OAuth device-code flow at `auth.openai.com`),
2. Stores the resulting access / refresh tokens **encrypted on
   the user's behalf**, and
3. Relays messages between iMessage and the public ChatGPT Codex web API
   (`chatgpt.com/backend-api/wham/*`) that the user is already authorized to use.

No OpenAI infrastructure is hosted, mirrored, or reverse-engineered here.
All API traffic uses official, user-authenticated endpoints.

## Reporting concerns

If you are a rights holder and believe something in this repository
infringes on your rights, please open an issue or email
**daniel@photon.codes** and we will address it promptly.
