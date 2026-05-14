import {
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  OPENAI_KEY_PATTERN,
  verifyOpenAIKey,
} from "@/lib/openai-key";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(MIN_KEY_LENGTH, "Key looks too short.")
    .max(MAX_KEY_LENGTH, "Key looks too long.")
    .regex(OPENAI_KEY_PATTERN, "Key should start with sk- and contain only [A-Za-z0-9_-]."),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? (err.issues[0]?.message ?? "invalid body") : "invalid body";
    return NextResponse.json({ error: message, reason: "bad_shape" }, { status: 400 });
  }

  const verdict = await verifyOpenAIKey(parsed.apiKey);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: verdict.message, reason: verdict.reason },
      { status: verdict.reason === "network_error" ? 502 : 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
