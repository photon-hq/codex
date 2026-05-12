import { getDb } from "@/db/client";
import { events, type Tenant, tenants } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { runCodex } from "@/lib/openai";
import { eq } from "drizzle-orm";
import { type Message, type Space, Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const RESET_REACTION = "ok_hand";
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;

export class TenantWorker {
  private app: SpectrumApp | null = null;
  private running = false;
  private stopRequested = false;
  private backoffMs = MIN_BACKOFF_MS;

  constructor(private tenant: Tenant) {}

  get id() {
    return this.tenant.id;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    void this.loop();
  }

  async stop() {
    this.stopRequested = true;
    this.running = false;
    if (this.app) {
      try {
        await this.app.stop();
      } catch {}
      this.app = null;
    }
  }

  refresh(next: Tenant) {
    this.tenant = next;
  }

  private async loop() {
    while (!this.stopRequested) {
      try {
        await this.subscribe();
        this.backoffMs = MIN_BACKOFF_MS;
      } catch (err) {
        if (this.stopRequested) return;
        console.error(`[tenant ${this.tenant.id}] subscription error:`, err);
        await this.logEvent("error", "subscribe", { error: serializeError(err) });
        await sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private async subscribe() {
    const projectSecret = decrypt({
      ciphertext: this.tenant.spectrumProjectSecretCiphertext,
      iv: this.tenant.spectrumProjectSecretIv,
      tag: this.tenant.spectrumProjectSecretTag,
    });

    const app = await Spectrum({
      projectId: this.tenant.spectrumProjectId,
      projectSecret,
      providers: [imessage.config()],
    });
    this.app = app;
    console.log(`[tenant ${this.tenant.id}] subscribed (${this.tenant.phoneNumber})`);

    try {
      for await (const [space, message] of app.messages) {
        if (this.stopRequested) break;
        await this.handle(space, message).catch((err) => {
          console.error(`[tenant ${this.tenant.id}] handler error:`, err);
        });
      }
    } finally {
      try {
        await app.stop();
      } catch {}
      if (this.app === app) this.app = null;
    }
  }

  private async handle(space: Space<unknown>, message: Message) {
    const m = message as Message & {
      reply: (text: string) => Promise<unknown>;
      react?: (key: string) => Promise<unknown>;
    };

    if (m.content.type !== "text") {
      await m.reply(
        "This Codex bridge handles text messages only — voice and attachments coming soon.",
      );
      return;
    }
    const body = (m.content as { type: "text"; text: string }).text.trim();
    if (body.length === 0) return;

    if (body === "/new") {
      await this.resetThread();
      if (m.react) {
        await m.react(RESET_REACTION).catch(() => {});
      } else {
        await m.reply("New thread started. Send your first message.");
      }
      return;
    }

    if (!this.tenant.openaiKeyCiphertext || !this.tenant.openaiKeyIv || !this.tenant.openaiKeyTag) {
      await m.reply(
        "No OpenAI key configured for this number. Open the Codex on iMessage dashboard to add one.",
      );
      return;
    }

    const apiKey = decrypt({
      ciphertext: this.tenant.openaiKeyCiphertext,
      iv: this.tenant.openaiKeyIv,
      tag: this.tenant.openaiKeyTag,
    });

    const started = Date.now();
    try {
      await space.responding(async () => {
        const result = await runCodex({
          apiKey,
          model: this.tenant.codexModel,
          input: body,
          previousResponseId: this.tenant.previousResponseId,
        });
        await this.persistResponseId(result.responseId);
        await m.reply(result.output);
        await this.logEvent("out", "reply", {
          inLen: body.length,
          outLen: result.output.length,
          usage: result.usage,
          latencyMs: Date.now() - started,
        });
      });
    } catch (err) {
      console.error(`[tenant ${this.tenant.id}] codex error:`, err);
      await m.reply(friendlyError(err));
      await this.logEvent("error", "codex", {
        error: serializeError(err),
        latencyMs: Date.now() - started,
      });
    }
  }

  private async resetThread() {
    await getDb()
      .update(tenants)
      .set({ previousResponseId: null, updatedAt: new Date() })
      .where(eq(tenants.id, this.tenant.id));
    this.tenant = { ...this.tenant, previousResponseId: null };
    await this.logEvent("in", "/new", null);
  }

  private async persistResponseId(responseId: string) {
    await getDb()
      .update(tenants)
      .set({ previousResponseId: responseId, updatedAt: new Date() })
      .where(eq(tenants.id, this.tenant.id));
    this.tenant = { ...this.tenant, previousResponseId: responseId };
  }

  private async logEvent(direction: string, kind: string, payload: unknown) {
    try {
      await getDb()
        .insert(events)
        .values({
          tenantId: this.tenant.id,
          direction,
          kind,
          payload: payload as object | null,
        });
    } catch (err) {
      console.warn(`[tenant ${this.tenant.id}] event log failed:`, err);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthor/i.test(msg)) {
    return "Your OpenAI key was rejected. Open the dashboard to rotate it.";
  }
  if (/429|rate/i.test(msg)) {
    return "Hit OpenAI rate limits. Try again in a moment.";
  }
  return "Codex hit an error. Try again, or send /new to reset the thread.";
}
