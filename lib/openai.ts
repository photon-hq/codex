import OpenAI from "openai";

export interface RunCodexInput {
  apiKey: string;
  model: string;
  input: string;
  previousResponseId?: string | null;
  systemInstructions?: string;
  signal?: AbortSignal;
}

export interface RunCodexResult {
  output: string;
  responseId: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

const DEFAULT_INSTRUCTIONS = [
  "You are Codex, accessed by the user through iMessage.",
  "Replies render in a plain text message — keep responses concise, scannable, and free of markdown",
  "syntax that doesn't render in iMessage (no `**bold**` markers, no headings, no code fences unless",
  "the user explicitly asks for code).",
  "When the user texts `/new` the conversation will be reset before your next turn.",
].join(" ");

export async function runCodex(input: RunCodexInput): Promise<RunCodexResult> {
  const client = new OpenAI({ apiKey: input.apiKey });

  const response = await client.responses.create(
    {
      model: input.model,
      input: input.input,
      instructions: input.systemInstructions ?? DEFAULT_INSTRUCTIONS,
      previous_response_id: input.previousResponseId ?? undefined,
      store: true,
    },
    { signal: input.signal },
  );

  const output =
    response.output_text?.trim() ||
    response.output
      ?.flatMap((item) => {
        if (item.type !== "message") return [];
        return item.content.flatMap((c) => (c.type === "output_text" ? [c.text] : []));
      })
      .join("\n")
      .trim() ||
    "";

  return {
    output: output || "(Codex returned an empty response.)",
    responseId: response.id,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}
