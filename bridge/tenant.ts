import { getDb } from "@/db/client";
import { events, type Tenant, codexThreads, tenants } from "@/db/schema";
import {
  CodexCloudError,
  type ImageInput,
  type WhamEnvironment,
  createTask,
  ensureFreshAccessToken,
  followUp,
  listEnvironments,
  pickDefaultEnvironment,
  uploadImage,
  waitForReply,
} from "@/lib/codex-cloud";
import { decrypt, encrypt } from "@/lib/crypto";
import { and, eq } from "drizzle-orm";
import { type Message, type Space, Spectrum, richlink } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const RESET_REACTION = "👍";
const ACK_REACTION = "👍";
const DONE_REACTION = "❤️";
const CONNECT_ENVIRONMENTS_URL = "https://chatgpt.com/codex/settings/environments";
const CODEX_MODEL_PICKER_URL = "https://chatgpt.com/codex";
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const AUTH_FAILURE_THRESHOLD = 5;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
// Hold incoming non-command messages briefly so an image + caption (which
// iMessage delivers as two separate bubbles) reach Codex as a single task.
const BATCH_DEBOUNCE_MS = 1500;
const BATCH_MAX_MS = 8_000;
const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);
// Codex picks the model on the chatgpt.com side (per-task). The public
// /wham/tasks POST body does not accept a model field today, so we surface
// the canonical picker rather than pretending we can switch it from chat.
const AVAILABLE_MODELS = ["gpt-5-codex", "gpt-5", "gpt-5-mini"] as const;
const BRANCH_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const INTRO_TRIGGERS = new Set([
  "hey! tell me how to use codex in imessage",
  "tell me how to use codex in imessage",
]);

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;

interface MessageContent {
  type: string;
  text?: string;
  name?: string;
  mimeType?: string;
  read?: () => Promise<Buffer>;
  size?: number;
  emoji?: string;
  url?: string;
  items?: Array<{ content?: MessageContent }>;
  content?: MessageContent;
}

function flattenContent(top: MessageContent): MessageContent[] {
  if (top.type === "effect" && top.content) {
    return flattenContent(top.content);
  }
  if (top.type === "group" && Array.isArray(top.items)) {
    const out: MessageContent[] = [];
    for (const item of top.items) {
      const inner = item?.content;
      if (inner) out.push(...flattenContent(inner));
    }
    return out.length ? out : [top];
  }
  return [top];
}

interface PreparedInput {
  text: string;
  images: ImageInput[];
  unsupportedAttachments: number;
}

type ReplyableMessage = Message & {
  reply: (text: string) => Promise<unknown>;
  react?: (key: string) => Promise<unknown>;
};

interface BatchedItem {
  m: ReplyableMessage;
  content: MessageContent;
  bodyText: string;
}

interface PendingBatch {
  spaceId: string;
  space: Space<unknown>;
  items: BatchedItem[];
  voiceCount: number;
  debounceTimer: ReturnType<typeof setTimeout>;
  hardTimer: ReturnType<typeof setTimeout>;
  flushing: boolean;
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
  private consecutiveAuthFailures = 0;
  private messagesHandled = 0;
  private lastMessageAt: number | null = null;
  private currentSecretCiphertext: string | null = null;
  private pendingBatches = new Map<string, PendingBatch>();

  constructor(private tenant: Tenant) {}

  get id() {
    return this.tenant.id;
  }

  get isAuthDead() {
    return this.consecutiveAuthFailures >= AUTH_FAILURE_THRESHOLD;
  }

  get secretCiphertext() {
    return this.tenant.spectrumProjectSecretCiphertext;
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
    for (const batch of this.pendingBatches.values()) {
      clearTimeout(batch.debounceTimer);
      clearTimeout(batch.hardTimer);
    }
    this.pendingBatches.clear();
    if (this.app) {
      try {
        await this.app.stop();
      } catch {}
      this.app = null;
    }
  }

  refresh(next: Tenant) {
    const secretChanged =
      this.currentSecretCiphertext !== null &&
      next.spectrumProjectSecretCiphertext !== this.currentSecretCiphertext;
    this.tenant = next;
    if (secretChanged) {
      console.log(`[tenant ${this.tenant.id}] secret rotated — restarting subscription`);
      this.consecutiveAuthFailures = 0;
      void this.app?.stop().catch(() => {});
      this.app = null;
      if (!this.running) {
        this.running = true;
        this.stopRequested = false;
        void this.loop();
      }
    }
  }

  private async loop() {
    while (!this.stopRequested) {
      if (this.isAuthDead) {
        console.warn(
          `[tenant ${this.tenant.id}] auth failed ${this.consecutiveAuthFailures}x — pausing until DB row updates`,
        );
        await this.logEvent("status", "auth_paused", {
          consecutiveAuthFailures: this.consecutiveAuthFailures,
        });
        return;
      }
      try {
        await this.subscribe();
        this.backoffMs = MIN_BACKOFF_MS;
      } catch (err) {
        if (this.stopRequested) return;
        this.subscribed = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        this.lastErrorAt = Date.now();
        this.consecutiveFailures += 1;
        if (isAuthError(err)) this.consecutiveAuthFailures += 1;
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
    this.currentSecretCiphertext = this.tenant.spectrumProjectSecretCiphertext;
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
    this.consecutiveAuthFailures = 0;
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
    const m = message as ReplyableMessage;
    const top = m.content as MessageContent;

    // Flatten effect-wrapped and grouped messages so each leaf content gets
    // routed individually. iMessage occasionally delivers a screen effect
    // (e.g. invisible ink) or a multi-part bundle that should be treated like
    // separate bubbles for Codex.
    for (const content of flattenContent(top)) {
      await this.routeContent(space, m, content);
    }
  }

  private async routeContent(
    space: Space<unknown>,
    m: ReplyableMessage,
    content: MessageContent,
  ) {
    // Reactions / polls / contacts / richlinks: we ack via log but never
    // forward to Codex. Reactions on bot replies arrive here too and stay silent.
    if (content.type === "reaction") {
      await this.logEvent("in", "reaction", { emoji: content.emoji ?? null });
      return;
    }
    if (content.type === "poll" || content.type === "poll_option") {
      await this.logEvent("in", "poll", { type: content.type });
      return;
    }
    if (content.type === "contact") {
      await this.logEvent("in", "contact", {});
      return;
    }
    if (content.type === "richlink") {
      const url = typeof content.url === "string" ? content.url : null;
      await this.logEvent("in", "richlink", { url });
      const bodyText = url ? `Reference link: ${url}` : "";
      if (bodyText) this.enqueueForBatch(space, m, content, bodyText);
      return;
    }

    let bodyText = "";
    if (content.type === "text" && typeof content.text === "string") {
      bodyText = content.text.trim();
    }

    // Commands & intro triggers bypass the batcher so they stay snappy.
    if (bodyText === "/new") {
      this.flushBatchNow(space.id);
      await this.resetThread(space.id);
      if (m.react) {
        await m.react(RESET_REACTION).catch(() => {});
      } else {
        await m.reply("New Codex thread started. Send your first message.");
      }
      return;
    }
    if (INTRO_TRIGGERS.has(bodyText.toLowerCase())) {
      this.flushBatchNow(space.id);
      await this.sendOnboardingIntro(space, m);
      return;
    }
    if (bodyText.startsWith("/")) {
      this.flushBatchNow(space.id);
      const handled = await this.handleCommand(space, m, bodyText);
      if (handled) return;
    }

    if (!this.tenant.codexRefreshCiphertext) {
      await m.reply("Codex isn't linked for this number yet. Open the dashboard to sign in.");
      return;
    }

    // Voice, attachments (incl. stickers), text → queue into the per-space
    // batch so a caption + photo land on Codex as one task.
    this.enqueueForBatch(space, m, content, bodyText);
  }

  private enqueueForBatch(
    space: Space<unknown>,
    m: ReplyableMessage,
    content: MessageContent,
    bodyText: string,
  ) {
    if (m.react) {
      m.react(ACK_REACTION).catch(() => {});
    }
    const existing = this.pendingBatches.get(space.id);
    if (existing) {
      clearTimeout(existing.debounceTimer);
      existing.items.push({ m, content, bodyText });
      if (content.type === "voice") existing.voiceCount += 1;
      existing.debounceTimer = setTimeout(() => {
        void this.flushBatch(space.id);
      }, BATCH_DEBOUNCE_MS);
      return;
    }
    const batch: PendingBatch = {
      spaceId: space.id,
      space,
      items: [{ m, content, bodyText }],
      voiceCount: content.type === "voice" ? 1 : 0,
      debounceTimer: setTimeout(() => {
        void this.flushBatch(space.id);
      }, BATCH_DEBOUNCE_MS),
      hardTimer: setTimeout(() => {
        void this.flushBatch(space.id);
      }, BATCH_MAX_MS),
      flushing: false,
    };
    this.pendingBatches.set(space.id, batch);
  }

  private flushBatchNow(spaceId: string) {
    const batch = this.pendingBatches.get(spaceId);
    if (!batch || batch.flushing) return;
    clearTimeout(batch.debounceTimer);
    clearTimeout(batch.hardTimer);
    // Kick the flush but don't await it — the calling command (e.g. /help)
    // should respond immediately while the prior batch resolves in the background.
    void this.flushBatch(spaceId);
  }

  private async flushBatch(spaceId: string) {
    const batch = this.pendingBatches.get(spaceId);
    if (!batch || batch.flushing) return;
    batch.flushing = true;
    clearTimeout(batch.debounceTimer);
    clearTimeout(batch.hardTimer);
    this.pendingBatches.delete(spaceId);
    try {
      await this.dispatchBatch(batch);
    } catch (err) {
      console.error(`[tenant ${this.tenant.id}] batch dispatch failed:`, err);
    }
  }

  private async dispatchBatch(batch: PendingBatch) {
    const first = batch.items[0];
    if (!first) return;
    const space = batch.space;
    const headM = first.m;

    const texts: string[] = [];
    const images: ImageInput[] = [];
    let unsupportedAttachments = 0;

    for (const item of batch.items) {
      if (item.bodyText) texts.push(item.bodyText);
      const prepared = await this.prepareInput(item.content, "");
      if (prepared.images.length) images.push(...prepared.images);
      unsupportedAttachments += prepared.unsupportedAttachments;
    }

    const mergedText = texts.join("\n\n").trim();
    const voiceOnly = batch.voiceCount > 0 && !mergedText && images.length === 0;
    if (voiceOnly) {
      await headM.reply(
        "Voice notes aren't supported yet — send the same idea as text or a screenshot and I'll take it from there.",
      );
      if (headM.react) {
        headM.react(DONE_REACTION).catch(() => {});
      }
      await this.logEvent("in", "voice_only", { count: batch.voiceCount });
      return;
    }

    if (!mergedText && images.length === 0) return;

    const started = Date.now();
    try {
      await space.responding(async () => {
        const { accessToken, environmentId } = await this.ensureAccessAndEnv();
        const existing = await this.getThread(space.id);
        const inputText = mergedText || "What's in this image?";
        let result: Awaited<ReturnType<typeof createTask>> | Awaited<ReturnType<typeof followUp>>;
        if (existing?.lastTurnId) {
          result = await followUp({
            accessToken,
            taskId: existing.whamTaskId,
            previousTurnId: existing.lastTurnId,
            text: inputText,
            images,
          });
        } else {
          result = await createTask({
            accessToken,
            environmentId,
            branch: this.tenant.codexEnvironmentBranch,
            text: inputText,
            images,
          });
        }

        const reply = await waitForReply({ accessToken, taskId: result.task.id });
        const turnId = reply.current_turn_id ?? result.current_turn_id;
        await this.upsertThread(space.id, result.task.id, turnId);

        const voiceFooter =
          batch.voiceCount > 0 && (mergedText || images.length > 0)
            ? "(Voice notes aren't processed yet — send the gist as text and I'll act on it.)"
            : null;
        const composed = composeReply(
          reply.text,
          reply.error,
          reply.pull_request_url,
          unsupportedAttachments,
          voiceFooter,
        );
        const [firstChunk, ...restChunks] = composed.chunks;
        if (firstChunk !== undefined) await headM.reply(firstChunk);
        for (const chunk of restChunks) {
          await space.send(chunk);
        }
        if (composed.prUrl) {
          await space.send(richlink(composed.prUrl));
        }
        if (headM.react) {
          headM.react(DONE_REACTION).catch(() => {});
        }
        await this.logEvent("out", "reply", {
          taskId: result.task.id,
          status: reply.status,
          inLen: inputText.length,
          imageCount: images.length,
          batchSize: batch.items.length,
          voiceCount: batch.voiceCount,
          outLen: composed.chunks.reduce((n, c) => n + c.length, 0),
          chunkCount: composed.chunks.length,
          latencyMs: Date.now() - started,
        });
      });
    } catch (err) {
      console.error(`[tenant ${this.tenant.id}] codex error:`, err);
      if (err instanceof CodexCloudError && err.status === 412) {
        await headM.reply(
          "Connect a GitHub repo to Codex before texting — I need an environment to run in.",
        );
        await space.send(richlink(CONNECT_ENVIRONMENTS_URL));
      } else {
        await headM.reply(friendlyError(err));
      }
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

  private async sendOnboardingIntro(
    space: Space<unknown>,
    m: Message & {
      reply: (text: string) => Promise<unknown>;
      react?: (key: string) => Promise<unknown>;
    },
  ) {
    if (m.react) {
      m.react(ACK_REACTION).catch(() => {});
    }
    await m.reply(
      "Welcome to Codex on iMessage. Text me like you'd text a teammate — I'll spin up tasks against your connected GitHub repo and reply here when they're done.",
    );
    await space.send(
      [
        "A few commands you can use anytime:",
        "• /new — start a fresh thread",
        "• /branch <name> — switch the branch I run against",
        "• /switch — pick a different environment / repo",
        "• /model — see the active model",
        "• /help — list everything",
      ].join("\n"),
    );
    await space.send(
      "Try it: send a one-liner like “add a /version endpoint and open a PR.” I'll thumbs-up when I'm on it and heart it when the task is finished.",
    );
    if (m.react) {
      m.react(DONE_REACTION).catch(() => {});
    }
    await this.logEvent("out", "intro", { spaceId: space.id });
  }

  // Returns true if the message was a recognized command (handled, or unknown).
  private async handleCommand(
    space: Space<unknown>,
    m: Message & {
      reply: (text: string) => Promise<unknown>;
      react?: (key: string) => Promise<unknown>;
    },
    bodyText: string,
  ): Promise<boolean> {
    const [rawCmd, ...rest] = bodyText.split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const arg = rest.join(" ").trim();

    switch (cmd) {
      case "/help":
      case "/?": {
        await m.reply(
          [
            "Commands:",
            "/new — start a fresh Codex thread",
            "/branch — show current branch",
            "/branch <name> — switch branch (resets thread)",
            "/switch — list connected environments",
            "/switch <label-or-id> — pick environment (resets thread)",
            "/model — show model picker",
            "/help — this message",
          ].join("\n"),
        );
        return true;
      }
      case "/model": {
        const current = this.tenant.codexModel;
        if (!arg) {
          await m.reply(
            [
              `Model: ${current}`,
              "",
              "Codex picks the model per task on chatgpt.com/codex —",
              "open the model dropdown on a new task to change it.",
              "",
              `Known models: ${AVAILABLE_MODELS.join(", ")}`,
            ].join("\n"),
          );
          await space.send(richlink(CODEX_MODEL_PICKER_URL));
          return true;
        }
        const choice = AVAILABLE_MODELS.find((n) => n.toLowerCase() === arg.toLowerCase());
        if (!choice) {
          await m.reply(`Unknown model "${arg}". Known: ${AVAILABLE_MODELS.join(", ")}.`);
          return true;
        }
        await getDb()
          .update(tenants)
          .set({ codexModel: choice, updatedAt: new Date() })
          .where(eq(tenants.id, this.tenant.id));
        this.tenant = { ...this.tenant, codexModel: choice };
        await this.logEvent("in", "/model", { model: choice });
        await m.reply(
          `Preference saved as ${choice}. Pick it per-task on the web for now — the create-task API doesn't accept a model field yet.`,
        );
        await space.send(richlink(CODEX_MODEL_PICKER_URL));
        return true;
      }
      case "/branch": {
        if (!arg) {
          await m.reply(
            `Branch: ${this.tenant.codexEnvironmentBranch}\nReply /branch <name> to switch.`,
          );
          return true;
        }
        if (!BRANCH_RE.test(arg)) {
          await m.reply("Invalid branch name. Use letters, numbers, ./-/_ only.");
          return true;
        }
        await getDb()
          .update(tenants)
          .set({ codexEnvironmentBranch: arg, updatedAt: new Date() })
          .where(eq(tenants.id, this.tenant.id));
        this.tenant = { ...this.tenant, codexEnvironmentBranch: arg };
        await this.resetThread(m.space.id);
        await this.logEvent("in", "/branch", { branch: arg });
        await m.reply(`Branch set to ${arg}. Started a fresh thread.`);
        return true;
      }
      case "/switch":
      case "/env": {
        let envs: WhamEnvironment[];
        try {
          const { accessToken } = await this.ensureAccessAndEnv();
          envs = await listEnvironments(accessToken);
        } catch (err) {
          if (err instanceof CodexCloudError && err.status === 412) {
            await m.reply("Connect a GitHub repo to Codex first — link to follow.");
            await space.send(richlink(CONNECT_ENVIRONMENTS_URL));
            return true;
          }
          throw err;
        }
        const usable = envs.filter((e) => e.repos.length > 0 && !e.archived);
        if (!arg) {
          if (usable.length === 0) {
            await m.reply("No environments with a connected repo yet.");
            return true;
          }
          const current = this.tenant.codexEnvironmentId;
          const lines = usable.slice(0, 10).map((e) => {
            const repo = e.repos[0] ?? "no repo";
            const short = e.id.slice(0, 8);
            const mark = e.id === current ? " (current)" : "";
            return `• ${e.label} — ${repo} [${short}]${mark}`;
          });
          await m.reply(
            ["Environments:", ...lines, "", "Reply /switch <label or id> to pick."].join("\n"),
          );
          return true;
        }
        const q = arg.toLowerCase();
        const picked =
          usable.find((e) => e.id === arg) ??
          usable.find((e) => e.id.toLowerCase().startsWith(q)) ??
          usable.find((e) => e.label.toLowerCase() === q) ??
          usable.find((e) => e.label.toLowerCase().includes(q)) ??
          usable.find((e) => e.repos.some((r) => r.toLowerCase().includes(q)));
        if (!picked) {
          await m.reply(`No environment matched "${arg}". Send /switch to see the list.`);
          return true;
        }
        await getDb()
          .update(tenants)
          .set({ codexEnvironmentId: picked.id, updatedAt: new Date() })
          .where(eq(tenants.id, this.tenant.id));
        this.tenant = { ...this.tenant, codexEnvironmentId: picked.id };
        await this.resetThread(m.space.id);
        await this.logEvent("in", "/switch", { environmentId: picked.id, label: picked.label });
        await m.reply(
          `Switched to ${picked.label} (${picked.repos[0] ?? "no repo"}). Started a fresh thread.`,
        );
        return true;
      }
      default:
        return false;
    }
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

function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (e.status === 401 || e.status === 403) return true;
  if (e.code === "401" || e.code === "403") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return /invalid credentials|unauthor|forbidden/.test(msg);
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
  voiceFooter?: string | null,
): { chunks: string[]; prUrl: string | null } {
  const chunks: string[] = [];
  if (text) chunks.push(...splitIntoBubbles(text));
  if (error) chunks.push(`Codex error: ${error}`);
  if (prUrl) chunks.push("PR opened — link to follow.");
  if (unsupportedAttachments > 0) {
    chunks.push(
      unsupportedAttachments === 1
        ? "(One attachment was skipped — only PNG/JPEG/GIF/WEBP under 20 MB are forwarded.)"
        : `(${unsupportedAttachments} attachments were skipped — only PNG/JPEG/GIF/WEBP under 20 MB are forwarded.)`,
    );
  }
  if (voiceFooter) chunks.push(voiceFooter);
  if (chunks.length === 0) {
    chunks.push("Codex returned an empty reply. Try again or send /new.");
  }
  return { chunks, prUrl };
}

// Split a model reply into iMessage-sized bubbles on blank-line paragraph breaks,
// stripping markdown syntax so iMessage doesn't render raw `**`, `__`, headings,
// links, etc. Fenced ```code``` blocks stay as a single bubble (just minus the
// fence markers) so snippets don't get shattered.
function splitIntoBubbles(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const FENCE = /```[\s\S]*?(?:```|$)/g;
  const tokens: Array<{ kind: "fence" | "prose"; text: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(FENCE)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push({ kind: "prose", text: text.slice(cursor, start) });
    tokens.push({ kind: "fence", text: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) tokens.push({ kind: "prose", text: text.slice(cursor) });

  const bubbles: string[] = [];
  for (const tok of tokens) {
    if (tok.kind === "fence") {
      const stripped = stripFence(tok.text);
      if (stripped) bubbles.push(stripped);
      continue;
    }
    for (const piece of tok.text.split(/\n{2,}/)) {
      const cleaned = stripProseMarkdown(piece).trim();
      if (cleaned) bubbles.push(cleaned);
    }
  }
  return bubbles;
}

// Strip the surrounding ```lang ... ``` fence, keeping inner lines verbatim
// (code may contain markdown-looking characters that we must not touch).
function stripFence(block: string): string {
  let inner = block.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
  inner = inner.replace(/^\n+/, "").replace(/\n+$/, "");
  return inner;
}

// Convert prose markdown into plain text suitable for iMessage bubbles.
function stripProseMarkdown(input: string): string {
  let out = input;

  // Inline code: `foo` -> foo
  out = out.replace(/`+([^`\n]+?)`+/g, "$1");

  // Images: ![alt](url) -> alt (url) or just url
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) =>
    alt ? `${alt} (${url})` : url,
  );

  // Links: [text](url) -> text (url), or just url when text === url
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) =>
    label.trim() === url.trim() ? url : `${label} (${url})`,
  );

  // Bold + italic markers: ***text***, **text**, __text__, _text_, *text*
  out = out.replace(/\*\*\*([^*\n]+?)\*\*\*/g, "$1");
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
  out = out.replace(/__([^_\n]+?)__/g, "$1");
  // Single * italics — avoid eating bullet stars or "*" floating in code-ish text.
  out = out.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, "$1$2");
  // Single _ italics — keep underscores inside identifiers (e.g. foo_bar).
  out = out.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?:;]|$)/g, "$1$2");

  // Strikethrough: ~~text~~ -> text
  out = out.replace(/~~([^~\n]+?)~~/g, "$1");

  // Headings: leading "# ", "## ", ... -> strip markers only
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // Blockquotes: leading "> " -> drop the marker
  out = out.replace(/^\s{0,3}>\s?/gm, "");

  // Bulleted lists: leading "-", "*", "+" -> "• "
  out = out.replace(/^(\s*)[-*+]\s+/gm, "$1• ");

  // Horizontal rules on their own line
  out = out.replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");

  // Common HTML entities (Codex rarely emits these, but cheap to handle).
  out = out
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return out;
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
