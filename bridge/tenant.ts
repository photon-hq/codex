import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { type Message, richlink, type Space, Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { getDb } from "@/db/client";
import {
  type BatchQueueRow,
  batchQueue,
  codexThreads,
  events,
  type Tenant,
  TENANT_STATUS,
  tenants,
} from "@/db/schema";
import {
  CodexCloudError,
  createTask,
  ensureFreshAccessToken,
  followUp,
  type ImageInput,
  isCodexNetworkError,
  isContextLengthExceededError,
  isGithubLinkMissingError,
  isInvalidGrantError,
  isMfaRequiredError,
  isUsageLimitError,
  isWorkspaceBlockedError,
  listEnvironments,
  pickDefaultEnvironment,
  uploadImage,
  type WhamEnvironment,
  waitForReply,
} from "@/lib/codex-cloud";
import { decrypt, encrypt } from "@/lib/crypto";

const RESET_REACTION = "👍";
const ACK_REACTION = "👍";
const DONE_REACTION = "❤️";
const CONNECT_ENVIRONMENTS_URL = "https://chatgpt.com/codex/settings/environments";
const CHATGPT_SECURITY_URL = "https://chatgpt.com/#settings/Security";
const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;
const AUTH_FAILURE_THRESHOLD = 5;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
// Hold incoming non-command messages so an image + caption (which iMessage
// delivers as two separate bubbles) reach Codex as a single task. 5 seconds
// mirrors the debounce window Photon recommends in
// https://docs.photon.codes/best-practices/inbound-pipeline — long enough to
// capture real human bursts, short enough that the user doesn't think Codex
// stalled.
const BATCH_DEBOUNCE_MS = 5000;
const BATCH_MAX_MS = 20_000;
// If a dispatch claimed rows but never deleted them, treat the claim as
// abandoned and re-queue it after a short grace window. This covers deploy
// restarts where a worker dies after claiming rows but before Codex receives them.
const STALE_DISPATCH_MS = 30_000;
const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);
const BRANCH_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const INTRO_TRIGGERS = new Set([
  "hey! tell me how to use codex in imessage",
  "tell me how to use codex in imessage",
]);

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;

interface MessageContent {
  content?: MessageContent;
  emoji?: string;
  items?: Array<{ content?: MessageContent }>;
  mimeType?: string;
  name?: string;
  read?: () => Promise<Buffer>;
  size?: number;
  text?: string;
  type: string;
  url?: string;
}

function flattenContent(top: MessageContent): MessageContent[] {
  if (top.type === "effect" && top.content) {
    return flattenContent(top.content);
  }
  if (top.type === "group" && Array.isArray(top.items)) {
    const out: MessageContent[] = [];
    for (const item of top.items) {
      const inner = item?.content;
      if (inner) {
        out.push(...flattenContent(inner));
      }
    }
    return out.length ? out : [top];
  }
  return [top];
}

type ReplyableMessage = Message & {
  reply: (text: string) => Promise<unknown>;
  react?: (key: string) => Promise<unknown>;
  sender?: { id?: string } | undefined;
};

// In-memory bookkeeping for a per-space debounce window. The *actual* messages
// live in the `batch_queue` Postgres table so they survive worker restarts.
// This map only holds timers and a reference to the live head Message so we
// can land the heart tapback on the right bubble.
interface PendingBatch {
  debounceTimer: ReturnType<typeof setTimeout>;
  flushing: boolean;
  hardTimer: ReturnType<typeof setTimeout>;
  headM: ReplyableMessage;
  space: Space<unknown>;
  spaceId: string;
}

export interface TenantHealth {
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastMessageAt: number | null;
  messagesHandled: number;
  phoneNumber: string;
  spectrumProjectId: string;
  subscribed: boolean;
  subscribedAt: number | null;
  tenantId: string;
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

  start() {
    if (this.running) {
      return;
    }
    console.log(
      `[tenant ${this.tenant.id}] worker.start (${this.tenant.phoneNumber}) project=${this.tenant.spectrumProjectId}`
    );
    this.running = true;
    this.stopRequested = false;
    void this.loop();
  }

  async stop() {
    const wasSubscribed = this.subscribed;
    console.log(
      `[tenant ${this.tenant.id}] worker.stop requested (${this.tenant.phoneNumber}) subscribed=${wasSubscribed}`
    );
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
      } catch (err) {
        console.warn(
          `[tenant ${this.tenant.id}] app.stop threw during worker.stop:`,
          err instanceof Error ? err.message : err
        );
      }
      this.app = null;
    }
    console.log(`[tenant ${this.tenant.id}] worker.stop complete (${this.tenant.phoneNumber})`);
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
          `[tenant ${this.tenant.id}] auth failed ${this.consecutiveAuthFailures}x — pausing until DB row updates`
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
        if (this.stopRequested) {
          return;
        }
        this.subscribed = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        this.lastErrorAt = Date.now();
        this.consecutiveFailures += 1;
        if (isAuthError(err)) {
          this.consecutiveAuthFailures += 1;
        }
        console.error(
          `[tenant ${this.tenant.id}] subscription error (#${this.consecutiveFailures}):`,
          err
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
      `[tenant ${this.tenant.id}] subscribed (${this.tenant.phoneNumber}) project=${this.tenant.spectrumProjectId}`
    );
    await this.logEvent("status", "subscribed", { phoneNumber: this.tenant.phoneNumber });

    // Replay any in-flight batches whose worker died mid-dispatch. Fire-and-
    // forget — we don't want to block the message loop while Codex catches up.
    void this.recoverOrphanedBatches().catch((err) => {
      console.error(`[tenant ${this.tenant.id}] orphan recovery failed:`, err);
    });
    setTimeout(() => {
      if (this.stopRequested || this.app !== app) {
        return;
      }
      void this.recoverOrphanedBatches().catch((err) => {
        console.error(`[tenant ${this.tenant.id}] delayed orphan recovery failed:`, err);
      });
    }, STALE_DISPATCH_MS + 1000);

    let streamEndReason: "stop_requested" | "iterator_returned" | "iterator_threw" =
      "iterator_returned";
    try {
      for await (const [space, message] of app.messages) {
        if (this.stopRequested) {
          streamEndReason = "stop_requested";
          break;
        }
        this.messagesHandled += 1;
        this.lastMessageAt = Date.now();
        await this.handle(space, message).catch((err) => {
          console.error(`[tenant ${this.tenant.id}] handler error:`, err);
        });
      }
    } catch (err) {
      streamEndReason = "iterator_threw";
      console.warn(
        `[tenant ${this.tenant.id}] message iterator threw (${this.tenant.phoneNumber}):`,
        err instanceof Error ? err.message : err
      );
    } finally {
      this.subscribed = false;
      try {
        await app.stop();
      } catch {}
      if (this.app === app) {
        this.app = null;
      }
      console.warn(
        `[tenant ${this.tenant.id}] message stream ended reason=${streamEndReason} ` +
          `(${this.tenant.phoneNumber}) project=${this.tenant.spectrumProjectId} — will reconnect`
      );
    }
  }

  private async handle(space: Space<unknown>, message: Message) {
    const m = message as ReplyableMessage;
    const top = m.content as MessageContent;
    console.log(
      `[tenant ${this.tenant.id}] inbound (${this.tenant.phoneNumber}) space=${space.id} ` +
        `type=${top?.type ?? "unknown"} sender=${m.sender?.id ?? "?"}`
    );

    // Flatten effect-wrapped and grouped messages so each leaf content gets
    // routed individually. iMessage occasionally delivers a screen effect
    // (e.g. invisible ink) or a multi-part bundle that should be treated like
    // separate bubbles for Codex.
    for (const content of flattenContent(top)) {
      await this.routeContent(space, m, content);
    }
  }

  private async routeContent(space: Space<unknown>, m: ReplyableMessage, content: MessageContent) {
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
      if (bodyText) {
        await this.enqueueForBatch(space, m, content, bodyText);
      }
      return;
    }

    let bodyText = "";
    if (content.type === "text" && typeof content.text === "string") {
      bodyText = content.text.trim();
    }

    // Commands & intro triggers bypass the batcher so they stay snappy.
    // `/new` alone resets the thread; `/new <text>` resets it and uses the
    // trailing text as the first prompt of the fresh thread.
    const newMatch = /^\/new(?:\s+([\s\S]+))?$/.exec(bodyText);
    if (newMatch) {
      this.flushBatchNow(space.id);
      await this.resetThread(space.id);
      const followup = newMatch[1]?.trim() ?? "";
      if (!followup) {
        if (m.react) {
          await m.react(RESET_REACTION).catch(() => {});
        } else {
          await m.reply("New Codex thread started. Send your first message.");
        }
        return;
      }
      // `/new <text>`: tapback to acknowledge the reset, then enqueue the
      // trailing text as the first prompt of the fresh thread. Fire the
      // tapback in parallel so the enqueue doesn't wait on Spectrum.
      if (m.react) {
        m.react(RESET_REACTION).catch(() => {});
      }
      if (!this.tenant.codexRefreshCiphertext) {
        await m.reply("Codex isn't linked for this number yet. Open the dashboard to sign in.");
        return;
      }
      await this.enqueueForBatch(space, m, content, followup);
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
      if (handled) {
        return;
      }
    }

    if (!this.tenant.codexRefreshCiphertext) {
      await m.reply("Codex isn't linked for this number yet. Open the dashboard to sign in.");
      return;
    }

    if (this.tenant.status === TENANT_STATUS.NEEDS_RELINK) {
      // ChatGPT rejected our refresh token earlier (revoked / password
      // changed / workspace removed). Don't bother enqueuing — just send
      // the short re-link notice. Costs nothing, doesn't touch OpenAI.
      await m.reply(this.relinkMessage());
      await this.logEvent("in", "needs_relink_blocked", {});
      return;
    }

    await this.enqueueForBatch(space, m, content, bodyText);
  }

  private relinkMessage(): string {
    return buildRelinkMessage();
  }

  private async enqueueForBatch(
    space: Space<unknown>,
    m: ReplyableMessage,
    content: MessageContent,
    bodyText: string
  ) {
    if (m.react) {
      m.react(ACK_REACTION).catch(() => {});
    }
    // Eagerly upload images during the debounce window. This way the image is
    // durable on Codex's side before we'd want to dispatch, and a worker
    // restart can replay using only the persisted ImageInput payload.
    let kind: "text" | "image" | "voice" | "skipped" = "text";
    let imagePayload: ImageInput | null = null;
    if (content.type === "voice") {
      kind = "voice";
    } else if (content.type === "attachment") {
      const uploaded = await this.tryUploadAttachment(content).catch(() => null);
      if (uploaded) {
        kind = "image";
        imagePayload = uploaded;
      } else {
        kind = "skipped";
      }
    } else if (bodyText) {
      kind = "text";
    } else {
      // Nothing actionable (e.g. an effect with no inner content). Skip.
      return;
    }

    try {
      await getDb()
        .insert(batchQueue)
        .values({
          tenantId: this.tenant.id,
          spaceId: space.id,
          kind,
          bodyText: bodyText || null,
          imagePayload: imagePayload as unknown as Record<string, unknown> | null,
          spectrumMessageId: m.id ?? null,
          senderId: m.sender?.id ?? null,
        });
    } catch (err) {
      console.error(`[tenant ${this.tenant.id}] enqueue persist failed:`, err);
      // Fall through and continue with in-memory only behavior; better to
      // attempt a reply than silently drop.
    }

    const existing = this.pendingBatches.get(space.id);
    if (existing) {
      clearTimeout(existing.debounceTimer);
      existing.debounceTimer = setTimeout(() => {
        void this.flushBatch(space.id);
      }, BATCH_DEBOUNCE_MS);
      return;
    }
    const batch: PendingBatch = {
      spaceId: space.id,
      space,
      headM: m,
      debounceTimer: setTimeout(() => {
        void this.flushBatch(space.id);
      }, BATCH_DEBOUNCE_MS),
      hardTimer: setTimeout(() => {
        void this.flushBatch(space.id);
      }, BATCH_MAX_MS),
      flushing: false,
    };
    this.pendingBatches.set(space.id, batch);
    // Signal we've received them and are holding for the burst to settle.
    // Without this, a 5s debounce feels like Codex stalled.
    space.startTyping().catch(() => {});
  }

  private flushBatchNow(spaceId: string) {
    const batch = this.pendingBatches.get(spaceId);
    if (!batch || batch.flushing) {
      return;
    }
    clearTimeout(batch.debounceTimer);
    clearTimeout(batch.hardTimer);
    // Kick the flush but don't await it — the calling command (e.g. /help)
    // should respond immediately while the prior batch resolves in the background.
    void this.flushBatch(spaceId);
  }

  private async flushBatch(spaceId: string) {
    const batch = this.pendingBatches.get(spaceId);
    if (batch?.flushing) {
      return;
    }
    if (batch) {
      batch.flushing = true;
      clearTimeout(batch.debounceTimer);
      clearTimeout(batch.hardTimer);
      this.pendingBatches.delete(spaceId);
    }

    let rows: BatchQueueRow[] = [];
    try {
      rows = await this.claimQueuedRows(spaceId);
    } catch (err) {
      console.error(`[tenant ${this.tenant.id}] claim rows failed:`, err);
      return;
    }

    if (rows.length === 0) {
      return;
    }

    try {
      await this.dispatchBatch(rows, batch?.space, batch?.headM);
    } catch (err) {
      console.error(`[tenant ${this.tenant.id}] batch dispatch failed:`, err);
      await this.releaseRows(rows).catch((releaseErr) => {
        console.error(`[tenant ${this.tenant.id}] release rows failed:`, releaseErr);
      });
      return;
    }

    // Success or final error reply to the user means the batch was handled.
    // If the process dies before this point, startup recovery releases stale
    // dispatched_at claims so the next bridge process can retry them.
    await this.deleteRows(rows).catch((err) => {
      console.error(`[tenant ${this.tenant.id}] delete rows failed:`, err);
    });

  }

  private async claimQueuedRows(spaceId: string): Promise<BatchQueueRow[]> {
    const db = getDb();
    const claimed = await db
      .update(batchQueue)
      .set({ dispatchedAt: new Date() })
      .where(
        and(
          eq(batchQueue.tenantId, this.tenant.id),
          eq(batchQueue.spaceId, spaceId),
          isNull(batchQueue.dispatchedAt)
        )
      )
      .returning();
    return claimed.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  private async deleteRows(rows: BatchQueueRow[]) {
    if (rows.length === 0) {
      return;
    }
    const db = getDb();
    await db.delete(batchQueue).where(
      inArray(
        batchQueue.id,
        rows.map((r) => r.id)
      )
    );
  }

  private async releaseRows(rows: BatchQueueRow[]) {
    if (rows.length === 0) {
      return;
    }
    const db = getDb();
    await db
      .update(batchQueue)
      .set({ dispatchedAt: null })
      .where(
        inArray(
          batchQueue.id,
          rows.map((r) => r.id)
        )
      );
  }

  private async dispatchBatch(
    rows: BatchQueueRow[],
    space: Space<unknown> | undefined,
    headM: ReplyableMessage | undefined
  ) {
    if (rows.length === 0) {
      return;
    }

    // If we lost the live space (worker restart replay), reconstruct one from
    // the persisted spaceId via the iMessage provider. The chat thread on the
    // device is keyed by spaceId, so a fresh `space.send()` lands in the right
    // conversation even without a Message handle.
    const liveSpace = space ?? (await this.resolveSpace(rows));
    if (!liveSpace) {
      throw new Error(`could not resolve space ${rows[0].spaceId} for queued replay`);
    }

    // Tenant flipped to needs_relink between enqueue and dispatch (most
    // commonly because *another* batch's refresh attempt failed first).
    // Drain the queued rows with a single re-link notice instead of running
    // them through a doomed Codex call.
    if (this.tenant.status === TENANT_STATUS.NEEDS_RELINK) {
      try {
        if (headM) {
          await headM.reply(this.relinkMessage());
        } else {
          await liveSpace.send(this.relinkMessage());
        }
      } catch (replyErr) {
        console.warn(`[tenant ${this.tenant.id}] relink notice send failed:`, replyErr);
      }
      await this.logEvent("out", "needs_relink_drain", {
        batchSize: rows.length,
        replay: !headM,
      });
      return;
    }

    const texts: string[] = [];
    const images: ImageInput[] = [];
    let voiceCount = 0;
    let unsupportedAttachments = 0;
    for (const row of rows) {
      if (row.kind === "text" && row.bodyText) {
        texts.push(row.bodyText);
      } else if (row.kind === "image" && row.imagePayload) {
        images.push(row.imagePayload as unknown as ImageInput);
      } else if (row.kind === "voice") {
        voiceCount += 1;
      } else if (row.kind === "skipped") {
        unsupportedAttachments += 1;
      }
    }

    const mergedText = texts.join("\n\n").trim();
    const replayHint = headM ? "" : "(Picking up where we left off after a restart.) ";

    const voiceOnly = voiceCount > 0 && !mergedText && images.length === 0;
    if (voiceOnly) {
      liveSpace.stopTyping().catch(() => {});
      const reply = `${replayHint}Voice notes aren't supported yet — send the same idea as text or a screenshot and I'll take it from there.`;
      if (headM) {
        await headM.reply(reply);
        if (headM.react) {
          headM.react(DONE_REACTION).catch(() => {});
        }
      } else {
        await liveSpace.send(reply);
      }
      await this.logEvent("in", "voice_only", { count: voiceCount, replay: !headM });
      return;
    }

    if (!mergedText && images.length === 0) {
      liveSpace.stopTyping().catch(() => {});
      return;
    }

    const started = Date.now();
    try {
      await liveSpace.responding(async () => {
        const { accessToken, environmentId } = await this.ensureAccessAndEnv();
        const existing = await this.getThread(liveSpace.id);
        const inputText =
          replayHint + (mergedText || (images.length > 0 ? "What's in this image?" : ""));
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
        await this.upsertThread(liveSpace.id, result.task.id, turnId);

        const voiceFooter =
          voiceCount > 0 && (mergedText || images.length > 0)
            ? "(Voice notes aren't processed yet — send the gist as text and I'll act on it.)"
            : null;
        const composed = composeReply(
          reply.text,
          reply.error,
          reply.pull_request_url,
          unsupportedAttachments,
          voiceFooter
        );
        const [firstChunk, ...restChunks] = composed.chunks;
        if (firstChunk !== undefined) {
          if (headM) {
            await headM.reply(firstChunk);
          } else {
            await liveSpace.send(firstChunk);
          }
        }
        for (const chunk of restChunks) {
          await liveSpace.send(chunk);
        }
        if (composed.prUrl) {
          await liveSpace.send(richlink(composed.prUrl));
        }
        if (headM?.react) {
          headM.react(DONE_REACTION).catch(() => {});
        }
        await this.logEvent("out", "reply", {
          taskId: result.task.id,
          status: reply.status,
          inLen: inputText.length,
          imageCount: images.length,
          batchSize: rows.length,
          voiceCount,
          outLen: composed.chunks.reduce((n, c) => n + c.length, 0),
          chunkCount: composed.chunks.length,
          replay: !headM,
          latencyMs: Date.now() - started,
        });
      });
    } catch (err) {
      if (isInvalidGrantError(err)) {
        // Refresh token is dead. Flip the tenant once so subsequent batches
        // short-circuit before even decrypting tokens — no point retrying.
        await this.markNeedsRelink(`invalid_grant from /oauth/token (${err.status})`);
      } else if (isMfaRequiredError(err)) {
        console.warn(
          `[tenant ${this.tenant.id}] codex MFA-blocked — device-code token lacks MFA claim. ` +
            `Tenant must enable MFA AND "device code login" in chatgpt.com Settings → Security, ` +
            `then re-link Codex. (Workspace accounts may also need admin to allow device-code.)`
        );
      } else if (isGithubLinkMissingError(err)) {
        console.warn(
          `[tenant ${this.tenant.id}] codex GitHub-not-linked — Wham rejected with ` +
            `missing_github_connector_link. Tenant must connect GitHub at ` +
            `chatgpt.com → Codex → Environments and re-link Codex.`
        );
      } else if (isWorkspaceBlockedError(err)) {
        console.warn(
          `[tenant ${this.tenant.id}] codex workspace-blocked — 403 not MFA. ` +
            `Likely ChatGPT workspace admin blocked Codex for this member, or SSO ` +
            `restriction. See openai/codex#12651.`
        );
      } else if (isUsageLimitError(err)) {
        console.warn(
          `[tenant ${this.tenant.id}] codex usage-limit-reached — account out of ` +
            `Codex credits / hit plan ceiling.`
        );
      } else if (isContextLengthExceededError(err)) {
        console.warn(
          `[tenant ${this.tenant.id}] codex context-length-exceeded — thread too ` +
            `long, nudging user to /new.`
        );
      } else if (isCodexNetworkError(err)) {
        console.warn(
          `[tenant ${this.tenant.id}] codex network error after retries — ${err.message}`
        );
      } else if (err instanceof CodexCloudError && err.status >= 500 && err.status < 600) {
        console.warn(
          `[tenant ${this.tenant.id}] codex 5xx after retries — ${err.status} ${err.message}`
        );
      } else {
        console.error(`[tenant ${this.tenant.id}] codex error:`, err);
      }
      // Pick the most useful chatgpt.com deep link for this error class so
      // the user gets a tappable rich-link card with the reply, not just a
      // URL embedded in body text. Mirrors the onboarding panels' primary
      // button → same destination, same one-tap UX.
      let helpUrl: string | null = null;
      if (isMfaRequiredError(err)) {
        helpUrl = CHATGPT_SECURITY_URL;
      } else if (
        isGithubLinkMissingError(err) ||
        (err instanceof CodexCloudError && err.status === 412)
      ) {
        helpUrl = CONNECT_ENVIRONMENTS_URL;
      } else if (isUsageLimitError(err)) {
        helpUrl = "https://chatgpt.com/#settings/Subscription";
      }

      const errorText =
        err instanceof CodexCloudError && err.status === 412
          ? "Connect a GitHub repo to Codex before texting — I need an environment to run in."
          : friendlyError(err);
      try {
        if (headM) {
          await headM.reply(errorText);
        } else {
          await liveSpace.send(errorText);
        }
        if (helpUrl) {
          await liveSpace.send(richlink(helpUrl));
        }
      } catch (replyErr) {
        console.error(`[tenant ${this.tenant.id}] error reply failed:`, replyErr);
      }
      await this.logEvent("error", "codex", {
        error: serializeError(err),
        replay: !headM,
        latencyMs: Date.now() - started,
      });
    }
  }

  private async resolveSpace(rows: BatchQueueRow[]): Promise<Space<unknown> | undefined> {
    if (!this.app) {
      return;
    }
    const senderId = rows.find((r) => r.senderId)?.senderId;
    if (!senderId) {
      return;
    }
    try {
      const im = imessage(this.app);
      const user = await im.user(senderId);
      return await im.space(user);
    } catch (err) {
      console.warn(`[tenant ${this.tenant.id}] resolveSpace failed:`, err);
      return;
    }
  }

  // Recover queue rows orphaned by a crash or deployment restart. It runs once
  // immediately after subscription and once more after the stale-claim grace
  // window so rows claimed just before restart are also retried.
  private async recoverOrphanedBatches() {
    const db = getDb();
    // Any rows we claimed but never deleted (the dispatch died mid-flight
    // before the reply was sent) become eligible for retry once they age out.
    await db
      .update(batchQueue)
      .set({ dispatchedAt: null })
      .where(
        and(
          eq(batchQueue.tenantId, this.tenant.id),
          sql`${batchQueue.dispatchedAt} IS NOT NULL`,
          lt(batchQueue.dispatchedAt, new Date(Date.now() - STALE_DISPATCH_MS))
        )
      );

    // Any spaces that still have unclaimed rows get replayed via flushBatch,
    // which reconstructs the live Space from the stored sender_id.
    const pendingRows = await db
      .select({ spaceId: batchQueue.spaceId })
      .from(batchQueue)
      .where(and(eq(batchQueue.tenantId, this.tenant.id), isNull(batchQueue.dispatchedAt)));
    const spaceIds = Array.from(new Set(pendingRows.map((r) => r.spaceId)));
    if (spaceIds.length === 0) {
      return;
    }
    console.warn(
      `[tenant ${this.tenant.id}] recovering ${spaceIds.length} orphaned space(s) from queue`
    );
    await this.logEvent("status", "queue_recover", { spaces: spaceIds.length });
    for (const spaceId of spaceIds) {
      await this.flushBatch(spaceId);
    }
  }

  private async tryUploadAttachment(content: MessageContent): Promise<ImageInput | null> {
    const mime = (content.mimeType ?? "").toLowerCase();
    if (!(SUPPORTED_IMAGE_MIME.has(mime) && content.read)) {
      return null;
    }
    let bytes: Buffer;
    try {
      bytes = await content.read();
    } catch (err) {
      console.warn(`[tenant ${this.tenant.id}] attachment read failed:`, err);
      return null;
    }
    if (!bytes || bytes.byteLength === 0) {
      return null;
    }
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return null;
    }
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
      !(
        this.tenant.codexRefreshCiphertext &&
        this.tenant.codexRefreshIv &&
        this.tenant.codexRefreshTag &&
        this.tenant.codexAccessCiphertext &&
        this.tenant.codexAccessIv &&
        this.tenant.codexAccessTag
      )
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
          null
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

  // Flip the tenant to needs_relink and update the in-memory snapshot so
  // subsequent dispatches in this worker also short-circuit. Idempotent.
  private async markNeedsRelink(reason: string) {
    if (this.tenant.status === TENANT_STATUS.NEEDS_RELINK) {
      return;
    }
    console.warn(
      `[tenant ${this.tenant.id}] marking needs_relink (${reason}) — ChatGPT ` +
        `rejected our refresh token. Worker will short-circuit replies until ` +
        `the user re-links from the dashboard.`
    );
    try {
      await getDb()
        .update(tenants)
        .set({ status: TENANT_STATUS.NEEDS_RELINK, updatedAt: new Date() })
        .where(eq(tenants.id, this.tenant.id));
      this.tenant = { ...this.tenant, status: TENANT_STATUS.NEEDS_RELINK };
    } catch (err) {
      console.error(`[tenant ${this.tenant.id}] markNeedsRelink update failed:`, err);
    }
    await this.logEvent("error", "needs_relink", { reason });
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
    }
  ) {
    if (m.react) {
      m.react(ACK_REACTION).catch(() => {});
    }
    await m.reply(
      "Welcome to Codex on iMessage. Send me tasks and I'll run them against your connected repo."
    );
    await space.send(
      "Type /new to start a new thread, /switch to change repo or environment, or /help for everything else."
    );
    if (m.react) {
      m.react(DONE_REACTION).catch(() => {});
    }
    await this.logEvent("out", "intro", { spaceId: space.id });
  }

  private async handleCommand(
    space: Space<unknown>,
    m: Message & {
      reply: (text: string) => Promise<unknown>;
      react?: (key: string) => Promise<unknown>;
    },
    bodyText: string
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
            "/new <message> — start a fresh thread and send <message> as the first prompt",
            "/branch — show current branch",
            "/branch <name> — switch branch (resets thread)",
            "/switch — list connected environments",
            "/switch <number> — pick environment (resets thread)",
            "/help — this message",
          ].join("\n")
        );
        return true;
      }
      case "/branch": {
        if (!arg) {
          await m.reply(
            `Branch: ${this.tenant.codexEnvironmentBranch}\nReply /branch <name> to switch.`
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
        const usable = envs.filter((e) => e.repos.length > 0 && !e.archived).slice(0, 10);
        if (!arg) {
          if (usable.length === 0) {
            await m.reply("No environments with a connected repo yet.");
            return true;
          }
          const current = this.tenant.codexEnvironmentId;
          const lines = usable.map((e, i) => {
            const repo = e.repos[0] ?? "no repo";
            const mark = e.id === current ? " (current)" : "";
            return `${i + 1}. ${e.label} — ${repo}${mark}`;
          });
          await m.reply(
            ["Environments:", ...lines, "", "Reply /switch <number> to pick."].join("\n")
          );
          return true;
        }
        // Numeric pick first (1-indexed list above); fall back to label/id
        // substring match so the existing UX keeps working for power users.
        let picked: WhamEnvironment | undefined;
        if (/^\d+$/.test(arg)) {
          const idx = Number.parseInt(arg, 10) - 1;
          if (idx >= 0 && idx < usable.length) {
            picked = usable[idx];
          }
        }
        if (!picked) {
          const q = arg.toLowerCase();
          picked =
            usable.find((e) => e.id === arg) ??
            usable.find((e) => e.id.toLowerCase().startsWith(q)) ??
            usable.find((e) => e.label.toLowerCase() === q) ??
            usable.find((e) => e.label.toLowerCase().includes(q)) ??
            usable.find((e) => e.repos.some((r) => r.toLowerCase().includes(q)));
        }
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
          `Switched to ${picked.label} (${picked.repos[0] ?? "no repo"}). Started a fresh thread.`
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
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (e.status === 401 || e.status === 403) {
    return true;
  }
  if (e.code === "401" || e.code === "403") {
    return true;
  }
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
  voiceFooter?: string | null
): { chunks: string[]; prUrl: string | null } {
  const chunks: string[] = [];
  if (text) {
    chunks.push(...splitIntoBubbles(text));
  }
  if (error) {
    chunks.push(`Codex error: ${error}`);
  }
  if (prUrl) {
    chunks.push("PR opened — link to follow.");
  }
  if (unsupportedAttachments > 0) {
    chunks.push(
      unsupportedAttachments === 1
        ? "(One attachment was skipped — only PNG/JPEG/GIF/WEBP under 20 MB are forwarded.)"
        : `(${unsupportedAttachments} attachments were skipped — only PNG/JPEG/GIF/WEBP under 20 MB are forwarded.)`
    );
  }
  if (voiceFooter) {
    chunks.push(voiceFooter);
  }
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
  if (!text) {
    return [];
  }
  const FENCE = /```[\s\S]*?(?:```|$)/g;
  const tokens: Array<{ kind: "fence" | "prose"; text: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(FENCE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      tokens.push({ kind: "prose", text: text.slice(cursor, start) });
    }
    tokens.push({ kind: "fence", text: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    tokens.push({ kind: "prose", text: text.slice(cursor) });
  }

  const bubbles: string[] = [];
  for (const tok of tokens) {
    if (tok.kind === "fence") {
      const stripped = stripFence(tok.text);
      if (stripped) {
        bubbles.push(stripped);
      }
      continue;
    }
    for (const piece of tok.text.split(/\n{2,}/)) {
      const cleaned = stripProseMarkdown(piece).trim();
      if (cleaned) {
        bubbles.push(cleaned);
      }
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
    alt ? `${alt} (${url})` : url
  );

  // Links: [text](url) -> text (url), or just url when text === url
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) =>
    label.trim() === url.trim() ? url : `${label} (${url})`
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

function buildRelinkMessage(): string {
  const url = process.env.PUBLIC_URL?.trim() || "the Codex dashboard";
  return (
    `Your ChatGPT sign-in for Codex has expired or was revoked. Open ${url} ` +
    `and re-link Codex to start sending messages again. (Your iMessage ` +
    `number and Spectrum project are intact — only the Codex sign-in needs ` +
    `refreshing.)`
  );
}

function friendlyError(err: unknown): string {
  if (isInvalidGrantError(err)) {
    return buildRelinkMessage();
  }
  if (isMfaRequiredError(err)) {
    return (
      "Codex says this account needs multi-factor authentication enabled before it " +
      "will accept device-code logins. On the ChatGPT account linked to this number, " +
      "go to chatgpt.com → Settings → Security and (1) enable MFA, and (2) enable " +
      "“device code login”. Then re-link Codex from the dashboard. If the account is " +
      "part of a ChatGPT workspace, an admin may also need to allow device-code login."
    );
  }
  if (isGithubLinkMissingError(err)) {
    return (
      "Codex isn't linked to GitHub on this ChatGPT account yet, so it can't run " +
      "tasks. Open chatgpt.com → Codex → Environments and connect GitHub, then " +
      "re-link Codex from the dashboard."
    );
  }
  if (isWorkspaceBlockedError(err)) {
    return (
      "Your ChatGPT workspace admin has blocked Codex cloud access for this account. " +
      "Ask the admin to allow Codex (and device-code login), or link a personal " +
      "ChatGPT account from the dashboard."
    );
  }
  if (isUsageLimitError(err)) {
    return (
      "You've hit this ChatGPT account's Codex usage limit. Upgrade your plan or " +
      "wait for the window to reset, then try again. (chatgpt.com → Settings → " +
      "Billing.)"
    );
  }
  if (isContextLengthExceededError(err)) {
    return (
      "This thread got too long for Codex to keep in context. Send /new to start " +
      "fresh — I'll lose the history but everything will work again."
    );
  }
  if (isCodexNetworkError(err)) {
    return (
      "Couldn't reach OpenAI right now. Try again in a moment — if it keeps " +
      "happening, OpenAI may be having an outage."
    );
  }
  if (err instanceof CodexCloudError) {
    if (err.status === 401) {
      return "ChatGPT session expired. Open the dashboard to sign in again.";
    }
    if (err.status === 412) {
      return err.message;
    }
    if (err.status === 429) {
      return "ChatGPT is rate-limiting Codex right now. Try again in a moment.";
    }
    if (err.status >= 500 && err.status < 600) {
      return (
        "OpenAI's Codex backend is having a moment. I'll retry on your next " +
        "message — or send /new to start fresh."
      );
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|unauthor/i.test(msg)) {
    return "ChatGPT session expired. Open the dashboard to sign in again.";
  }
  if (/429|rate/i.test(msg)) {
    return "ChatGPT is rate-limiting Codex right now. Try again in a moment.";
  }
  return "Codex hit an error. Try again, or send /new to start a fresh thread.";
}
