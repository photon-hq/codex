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

  openaiKeyCiphertext: text("openai_key_ciphertext"),
  openaiKeyIv: text("openai_key_iv"),
  openaiKeyTag: text("openai_key_tag"),

  previousResponseId: text("previous_response_id"),
  codexModel: text("codex_model").notNull().default("gpt-5-codex"),

  status: text("status").notNull().default("provisioned"),

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
export type EventRow = typeof events.$inferSelect;
