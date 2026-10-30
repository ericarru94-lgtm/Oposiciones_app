import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { AnthropicModelClient, buildRequest } = await import("@/lib/engine/anthropic");

const base = { system: "s", messages: [{ role: "user" as const, content: "Hola" }], tools: [], effort: "medium" as const };

function fakeClient(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return respond(String(url), init ?? {});
  };
  return { client: new Anthropic({ apiKey: "test", maxRetries: 0, fetch: fetch as typeof globalThis.fetch }), calls };
}

const message = (extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5",
      content: [{ type: "thinking", thinking: "", signature: "abc" }, { type: "text", text: "Hecho" }],
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 50,
               server_tool_use: { web_search_requests: 2 } },
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("cliente real de Claude (sin red)", () => {
  it("Opus y Sonnet llevan respaldo del servidor; Haiku no", () => {
    expect(buildRequest({ ...base, model: "claude-sonnet-5-5" })).toMatchObject({
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" }, max_tokens: 16000,
    });
    const haiku = buildRequest({ ...base, model: "claude-haiku-5-5" });
    expect(haiku).not.toHaveProperty("fallbacks");
    expect(haiku).not.toHaveProperty("thinking");
  });

  it("devuelve bloques intactos, consumo completo y modelo que respondió", async () => {
    const { client, calls } = fakeClient(() => message());
    const r = await new AnthropicModelClient(client).create({ ...base, model: "claude-sonnet-5-5" });
    expect(r.content[0]).toEqual({ type: "thinking", thinking: "", signature: "abc" });
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 500, cacheWriteTokens: 50, webSearchRequests: 2 });
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(calls[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(calls[0].body.fallbacks).toBe("default");
  });

  it("clasifica errores: 429 y 529 reintentables, 400 y 401 no", async () => {
    const statuses: [number, boolean][] = [[429, true], [529, true], [400, false], [401, false]];
    for (const [status, retryable] of statuses) {
      const { client } = fakeClient(() =>
        new Response(JSON.stringify({ type: "error", error: { type: "x", message: "m" } }), {
          status, headers: { "content-type": "application/json" },
        }),
      );
      await expect(new AnthropicModelClient(client).create({ ...base, model: "claude-haiku-5-5" })).rejects.toMatchObject({
        retryable,
      });
    }
  });

  it("un motivo de parada desconocido no se trata como éxito", async () => {
    const { client } = fakeClient(() => message({ stop_reason: "model_context_window_exceeded" }));
    const r = await new AnthropicModelClient(client).create({ ...base, model: "claude-haiku-5-5" });
    expect(r.stopReason).toBe("other");
  });
});
