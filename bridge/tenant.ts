import { getDb } from "@/db/client";
import { events, type Tenant, codexThreads, tenants } from "@/db/schema";
import {
  CodexCloudError,
  type ImageInput,
  createTask,
  ensureFreshAccessToken,
  followUp,
  pickDefaultEnvironment,
  uploadImage,
  waitForReply,
} from "@/lib/codex-cloud";
import { decrypt, encrypt } from "@/lib/crypto";
import { and, eq } from "drizzle-orm";
import { type Message, type Space, Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const RESET_REACTION = "ok_hand";
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;

interface MessageContent {
  type: string;
  text?: string;
  name?: string;
  mimeType?: string;
  read?: () => Promise<Buffer>;
  size?: number;
}

interface PreparedInput {
  text: string;
  images: ImageInput[];
  unsupportedAttachments: number;
}

export interface TenantHealth {
  tenantId: string;
  phoneNumber: string;
  spectrumProjectId: string;
  subscribed: boolean;
  subscribedAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  messagesHandled: number;
  lastMessageAt: number | null;
}

export class TenantWorker {
  private app: SpectrumApp | null = null;
  private running = false;
  private stopRequested = false;
  private backoffMs = MIN_BACKOFF_MS;
  private subscribed = false;
  private subscribedAt: number | null = null;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private consecutiveFailures = 0;
  private messagesHandled = 0;
  private lastMessageAt: number | null = null;

  constructor(private tenant: Tenant) {}

  get id() {
    return this.tenant.id;
  }

  health(): TenantHealth {
    return {
      tenantId: this.tenant.id,
      phoneNumber: this.tenant.phoneNumber,
      spectrumProjectId: this.tenant.spectrumProjectId,
      subscribed: this.subscribed,
      subscribedAt: this.subscribedAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      consecutiveFailures: this.consecutiveFailures,
      messagesHandled: this.messagesHandled,
      lastMessageAt: this.lastMessageAt,
    };
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
        this.subscribed = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        this.lastErrorAt = Date.now();
        this.consecutiveFailures += 1;
        console.error(
          `[tenant ${this.tenant.id}] subscription error (#${this.consecutiveFailures}):`,
          err,
        );
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
    this.subscribed = true;
    this.subscribedAt = Date.now();
    this.lastError = null;
    this.consecutiveFailures = 0;
    console.log(
      `[tenant ${this.tenant.id}] subscribed (${this.tenant.phoneNumber}) project=${this.tenant.spectrumProjectId}`,
    );
    await this.logEvent("status", "subscribed", { phoneNumber: this.tenant.phoneNumber });

    try {
      for await (const [space, message] of app.messages) {
        if (this.stopRequested) break;
        this.messagesHandled += 1;
        this.lastMessageAt = Date.now();
        await this.handle(space, message).catch((err) => {
          console.error(`[tenant ${this.tenant.id}] handler error:`, err);
        });
      }
    } finally {
      this.subscribed = false;
      try {
        await app.stop();
      } catch {}
      if (this.app === app) this.app = null;
      console.warn(`[tenant ${this.tenant.id}] message stream ended — will reconnect`);
    }
  }

  private async handle(space: Space<unknown>, message: Message) {
    const m = message as Message & {
      reply: (text: string) => Promise<unknown>;
      react?: (key: string) => Promise<unknown>;
    };
    const content = m.content as MessageContent;

    if (content.type === "reaction" || content.type === "poll" || content.type === "poll_option") {
      return;
    }

    if (content.type === "voice") {
      await m.reply("Voice notes aren't supported yet — try a text message or a photo.");
      return;
    }

    let bodyText = "";
    if (content.type === "text" && typeof content.text === "string") {
      bodyText = content.text.trim();
    }

    if (bodyText === "/new") {
      await this.resetThread(space.id);
      if (m.react) {
        await m.react(RESET_REACTION).catch(() => {});
      } else {
        await m.reply("New Codex thread started. Send your first message.");
      }
      return;
    }

    if (!this.tenant.codexRefreshCiphertext) {
      await m.reply("Codex isn't linked for this number yet. Open the dashboard to sign in.");
      return;
    }

    const prepared = await this.prepareInput(content, bodyText);
    if (!prepared.text && prepared.images.length === 0) return;

    const started = Date.now();
    try {
      await space.responding(async () => {
        const { accessToken, environmentId } = await this.ensureAccessAndEnv();
        const existing = await this.getThread(space.id);
        const inputText = prepared.text || "What's in this image?";
        let result: Awaited<ReturnType<typeof createTask>> | Awaited<ReturnType<typeof followUp>>;
        if (existing?.lastTurnId) {
          result = await followUp({
            accessToken,
            taskId: existing.whamTaskId,
            previousTurnId: existing.lastTurnId,
            text: inputText,
            images: prepared.images,
          });
        } else {
          result = await createTask({
            accessToken,
            environmentId,
            branch: this.tenant.codexEnvironmentBranch,
            text: inputText,
            images: prepared.images,
          });
        }

        const reply = await waitForReply({ accessToken, taskId: result.task.id });
        const turnId = reply.current_turn_id ?? result.current_turn_id;
        await this.upsertThread(space.id, result.task.id, turnId);

        const replyText = composeReply(
          reply.text,
          reply.error,
          reply.pull_request_url,
          prepared.unsupportedAttachments,
        );
        await m.reply(replyText);
        await this.logEvent("out", "reply", {
          taskId: result.task.id,
          status: reply.status,
          inLen: inputText.length,
          imageCount: prepared.images.length,
          outLen: replyText.length,
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

  private async prepareInput(content: MessageContent, bodyText: string): Promise<PreparedInput> {
    const images: ImageInput[] = [];
    let unsupportedAttachments = 0;
    if (content.type === "attachment" && content.read && content.mimeType) {
      const attached = await this.tryUploadAttachment(content);
      if (attached) images.push(attached);
      else unsupportedAttachments += 1;
    }
    return { text: bodyText, images, unsupportedAttachments };
  }

  private async tryUploadAttachment(content: MessageContent): Promise<ImageInput | null> {
    const mime = (content.mimeType ?? "").toLowerCase();
    if (!SUPPORTED_IMAGE_MIME.has(mime) || !content.read) return null;
    let bytes: Buffer;
    try {
      bytes = await content.read();
    } catch (err) {
      console.warn(`[tenant ${this.tenant.id}] attachment read failed:`, err);
      return null;
    }
    if (!bytes || bytes.byteLength === 0) return null;
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;
    const { accessToken } = await this.ensureAccessAndEnv();
    return uploadImage({
      accessToken,
      bytes,
      filename: content.name ?? `image.${mime.split("/")[1] ?? "bin"}`,
      mimeType: mime,
    });
  }

  private async ensureAccessAndEnv(): Promise<{ accessToken: string; environmentId: string }> {
    if (
      !this.tenant.codexRefreshCiphertext ||
      !this.tenant.codexRefreshIv ||
      !this.tenant.codexRefreshTag ||
      !this.tenant.codexAccessCiphertext ||
      !this.tenant.codexAccessIv ||
      !this.tenant.codexAccessTag
    ) {
      throw new CodexCloudError("Codex tokens missing for this tenant.", 401, null);
    }
    const refreshToken = decrypt({
      ciphertext: this.tenant.codexRefreshCiphertext,
      iv: this.tenant.codexRefreshIv,
      tag: this.tenant.codexRefreshTag,
    });
    const accessToken = decrypt({
      ciphertext: this.tenant.codexAccessCiphertext,
      iv: this.tenant.codexAccessIv,
      tag: this.tenant.codexAccessTag,
    });
    const expiresAt = this.tenant.codexAccessExpiresAt?.getTime() ?? 0;
    const fresh = await ensureFreshAccessToken({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    });
    if (fresh.rotated) {
      await this.persistTokens(fresh.access_token, fresh.refresh_token, fresh.expires_at);
    }

    let environmentId = this.tenant.codexEnvironmentId;
    if (!environmentId) {
      const env = await pickDefaultEnvironment(fresh.access_token);
      if (!env) {
        throw new CodexCloudError(
          "Connect a GitHub repo at chatgpt.com/codex/settings/environments before texting Codex.",
          412,
          null,
        );
      }
      environmentId = env.id;
      await getDb()
        .update(tenants)
        .set({ codexEnvironmentId: environmentId, updatedAt: new Date() })
        .where(eq(tenants.id, this.tenant.id));
      this.tenant = { ...this.tenant, codexEnvironmentId: environmentId };
    }
    return { accessToken: fresh.access_token, environmentId };
  }

  private async persistTokens(access: string, refresh: string, expiresAtMs: number) {
    const accessBlob = encrypt(access);
    const refreshBlob = encrypt(refresh);
    const expiresAt = new Date(expiresAtMs);
    await getDb()
      .update(tenants)
      .set({
        codexAccessCiphertext: accessBlob.ciphertext,
        codexAccessIv: accessBlob.iv,
        codexAccessTag: accessBlob.tag,
        codexRefreshCiphertext: refreshBlob.ciphertext,
        codexRefreshIv: refreshBlob.iv,
        codexRefreshTag: refreshBlob.tag,
        codexAccessExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, this.tenant.id));
    this.tenant = {
      ...this.tenant,
      codexAccessCiphertext: accessBlob.ciphertext,
      codexAccessIv: accessBlob.iv,
      codexAccessTag: accessBlob.tag,
      codexRefreshCiphertext: refreshBlob.ciphertext,
      codexRefreshIv: refreshBlob.iv,
      codexRefreshTag: refreshBlob.tag,
      codexAccessExpiresAt: expiresAt,
    };
  }

  private async getThread(spaceId: string) {
    const [row] = await getDb()
      .select()
      .from(codexThreads)
      .where(and(eq(codexThreads.tenantId, this.tenant.id), eq(codexThreads.spaceId, spaceId)))
      .limit(1);
    return row ?? null;
  }

  private async upsertThread(spaceId: string, taskId: string, turnId: string | null) {
    const existing = await this.getThread(spaceId);
    const now = new Date();
    if (existing) {
      await getDb()
        .update(codexThreads)
        .set({ whamTaskId: taskId, lastTurnId: turnId, updatedAt: now })
        .where(eq(codexThreads.id, existing.id));
    } else {
      await getDb().insert(codexThreads).values({
        tenantId: this.tenant.id,
        spaceId,
        whamTaskId: taskId,
        lastTurnId: turnId,
      });
    }
  }

  private async resetThread(spaceId: string) {
    await getDb()
      .delete(codexThreads)
      .where(and(eq(codexThreads.tenantId, this.tenant.id), eq(codexThreads.spaceId, spaceId)));
    await this.logEvent("in", "/new", { spaceId });
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

function composeReply(
  text: string,
  error: string | null,
  prUrl: string | null,
  unsupportedAttachments: number,
): string {
  const parts: string[] = [];
  if (text) parts.push(text);
  if (error) parts.push(`Codex error: ${error}`);
  if (prUrl) parts.push(`PR: ${prUrl}`);
  if (unsupportedAttachments > 0) {
    parts.push(
      unsupportedAttachments === 1
        ? "(One attachment was skipped — only PNG/JPEG/GIF/WEBP under 20 MB are forwarded.)"
        : `(${unsupportedAttachments} attachments were skipped — only PNG/JPEG/GIF/WEBP under 20 MB are forwarded.)`,
    );
  }
  if (parts.length === 0) return "Codex returned an empty reply. Try again or send /new.";
  return parts.join("\n\n");
}

function friendlyError(err: unknown): string {
  if (err instanceof CodexCloudError) {
    if (err.status === 401) return "ChatGPT session expired. Open the dashboard to sign in again.";
    if (err.status === 412) return err.message;
    if (err.status === 429)
      return "ChatGPT is rate-limiting Codex right now. Try again in a moment.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthor/i.test(msg))
    return "ChatGPT session expired. Open the dashboard to sign in again.";
  if (/429|rate/i.test(msg))
    return "ChatGPT is rate-limiting Codex right now. Try again in a moment.";
  return "Codex hit an error. Try again, or send /new to start a fresh thread.";
}
