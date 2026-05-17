import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  spectrumUserId: text("spectrum_user_id").notNull().unique(),
  spectrumEmail: text("spectrum_email"),
  spectrumUserName: text("spectrum_user_name"),

  spectrumProjectId: text("spectrum_project_id").notNull(),
  spectrumProjectSecretCiphertext: text("spectrum_project_secret_ciphertext").notNull(),
  spectrumProjectSecretIv: text("spectrum_project_secret_iv").notNull(),
  spectrumProjectSecretTag: text("spectrum_project_secret_tag").notNull(),

  spectrumLineId: text("spectrum_line_id").notNull(),
  phoneNumber: text("phone_number").notNull(),

  codexRefreshCiphertext: text("codex_refresh_ciphertext"),
  codexRefreshIv: text("codex_refresh_iv"),
  codexRefreshTag: text("codex_refresh_tag"),
  codexAccessCiphertext: text("codex_access_ciphertext"),
  codexAccessIv: text("codex_access_iv"),
  codexAccessTag: text("codex_access_tag"),
  codexAccessExpiresAt: timestamp("codex_access_expires_at", { withTimezone: true }),
  codexAccountId: text("codex_account_id"),
  codexUserEmail: text("codex_user_email"),
  codexEnvironmentId: text("codex_environment_id"),
  codexEnvironmentBranch: text("codex_environment_branch").notNull().default("main"),

  // One of TENANT_STATUS values below. Plain text column (not a Postgres
  // enum) so we can roll out new states without a migration.
  status: text("status").notNull().default("provisioned"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Lifecycle states for the `tenants.status` column. Kept as string literals
 * (rather than a Postgres enum) so adding a new state doesn't require a
 * schema migration — just a new value here and the worker logic to match.
 */
export const TENANT_STATUS = {
  /** Default. Tokens are believed-good; the bridge runs normally. */
  PROVISIONED: "provisioned",
  /**
   * The Codex refresh token has been rejected by ChatGPT's OAuth server
   * (revoked, password reset, workspace removal, etc.). The worker has
   * stopped trying to refresh and replies to inbound messages with a
   * single "re-link from the dashboard" notice. Cleared by /api/provision
   * when fresh tokens land via the device-auth flow.
   */
  NEEDS_RELINK: "needs_relink",
} as const;

export type TenantStatus = (typeof TENANT_STATUS)[keyof typeof TENANT_STATUS];

// Durable per-space inbound queue. Each row is one inbound iMessage bubble.
// Rows are inserted on receipt and deleted once a successful Codex reply has
// been sent. A worker restart picks up any rows that are still pending or
// were claimed by a now-dead dispatch.
export const batchQueue = pgTable("batch_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  spaceId: text("space_id").notNull(),
  // "text" — bodyText is the prompt; "image" — payload carries an already-
  // uploaded Codex ImageInput; "voice" — placeholder, audio is not forwarded.
  kind: text("kind").notNull(),
  bodyText: text("body_text"),
  imagePayload: jsonb("image_payload"),
  spectrumMessageId: text("spectrum_message_id"),
  // sender.id from the inbound Spectrum message — used to reconstruct the
  // Space via the iMessage provider after a worker restart when we no longer
  // have a live Message handle.
  senderId: text("sender_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when a dispatch claims this row. NULL while still queued.
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
});

export const codexThreads = pgTable("codex_threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  spaceId: text("space_id").notNull(),
  whamTaskId: text("wham_task_id").notNull(),
  lastTurnId: text("last_turn_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  direction: text("direction").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload"),
  latencyMs: integer("latency_ms"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type CodexThread = typeof codexThreads.$inferSelect;
export type NewCodexThread = typeof codexThreads.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type BatchQueueRow = typeof batchQueue.$inferSelect;
export type NewBatchQueueRow = typeof batchQueue.$inferInsert;
