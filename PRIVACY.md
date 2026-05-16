# Privacy Notice

_Last updated: 2026-05-16_

This document explains what **Codex on iMessage** ("the Service",
operated by [Photon](https://photon.codes)) collects, why, and how to
remove it.

## 1. What we store

We store the **minimum** needed to relay your iMessage threads to ChatGPT
Codex on your behalf:

| Data | Why | At rest |
| --- | --- | --- |
| ChatGPT OAuth access + refresh tokens | Talk to Codex as you | **AES‑256‑GCM encrypted**, key never leaves the server |
| Your ChatGPT user email (returned by OpenAI on sign-in) | Identify your account in the dashboard | Plain text |
| Phone number provisioned by Spectrum | Route incoming iMessages | Plain text |
| Codex environment ID + branch you selected | Send new tasks to the right repo | Plain text |
| Task IDs and last turn IDs returned by Codex | Continue conversations across messages | Plain text |
| Event log: timestamp + kind (e.g. "in/reaction", "out/reply") + lengths and latencies | Diagnose problems and rate-limiting | Plain text, retained ≤ 30 days |

We **do not** persistently store the body of your iMessage messages or
Codex's replies. The text is forwarded in-memory at request time and
then dropped. Event logs contain only metadata (counts, lengths,
status codes), not message bodies.

## 2. What goes to third parties

- **OpenAI / ChatGPT** receives the prompts and any images you send,
  exactly as if you typed them at `chatgpt.com/codex`. OpenAI's privacy
  policy applies: <https://openai.com/policies/privacy-policy/>.
- **Apple iMessage** carries the bubbles between your phone and the
  provisioned line. We do not control or persist the iMessage transport.
- **Spectrum** ([spectrum.photon.codes](https://spectrum.photon.codes))
  is the Photon-operated messaging backbone. It sees inbound and
  outbound bubble payloads in transit.

We do **not** sell or share your data with advertisers, brokers, or
analytics vendors.

## 3. Voice notes, stickers, contacts, reactions

- **Reactions** (tapbacks) are dropped immediately and never forwarded.
- **Voice notes** are not transcribed or forwarded; we acknowledge them
  and ignore the audio.
- **Contacts / polls** are dropped at ingest.
- **Stickers and images** are uploaded to ChatGPT as image attachments
  if their MIME type is supported (PNG / JPEG / GIF / WEBP under 20 MB).

## 4. Cookies and analytics

The web dashboard uses a single HTTP-only session cookie to keep you
logged in. We do not use third-party analytics, advertising pixels, or
fingerprinting.

## 5. Deleting your data

Click **Disconnect** on the dashboard at any time. We will:

1. Revoke the iMessage line so Codex stops replying immediately.
2. Wipe your ChatGPT OAuth tokens (encrypted blob + IV + tag).
3. Drop the tenant row and associated event log within 24 hours.

If you can't access the dashboard, email **hello@photon.codes** with
the phone number on file and we will remove the record manually.

## 6. Security

- Tokens are encrypted with AES‑256‑GCM using a master key held only on
  the server.
- Postgres is reachable only from the application network.
- Transport between you and our endpoints is TLS 1.2+.

We are a small team; if you find a vulnerability, please email
**security@photon.codes** rather than filing a public issue.

## 7. Children

The Service is not directed at children under 13. Do not use it if you
are under the minimum age required by ChatGPT / Apple in your country.

## 8. Changes

We will post material changes to this document at
[github.com/photon-hq/codex/blob/main/PRIVACY.md](https://github.com/photon-hq/codex/blob/main/PRIVACY.md).

## 9. Contact

Privacy questions: **hello@photon.codes**
Security disclosures: **security@photon.codes**
