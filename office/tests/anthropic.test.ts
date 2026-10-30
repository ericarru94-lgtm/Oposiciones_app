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
  it("sin respaldo automático de modelo, con caché, effort y herramientas web", () => {
    const req = buildRequest({
      ...base, model: "claude-sonnet-5-5",
      serverTools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    });
    expect(req).toMatchObject({ output_config: { effort: "medium" }, cache_control: { type: "ephemeral" }, max_tokens: 8000 });
    expect(req).not.toHaveProperty("fallbacks");
    expect(req).not.toHaveProperty("betas");
    expect(req).not.toHaveProperty("thinking");
    expect(req).not.toHaveProperty("temperature");
    expect(req.tools).toContainEqual({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
  });

  it("devuelve bloques intactos, consumo completo y modelo que respondió", async () => {
    const { client, calls } = fakeClient(() => message());
    const r = await new AnthropicModelClient(client).create({ ...base, model: "claude-sonnet-5-5" });
    expect(r.content[0]).toEqual({ type: "thinking", thinking: "", signature: "abc" });
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 500, cacheWriteTokens: 50, webSearchRequests: 2 });
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(calls[0].body.fallbacks).toBeUndefined();
    expect(calls[0].body.model).toBe("claude-sonnet-5-5");
  });

  it("clasifica errores: 429 y 529 reintentables sin cobro, 400 y 401 no; 500 de cobro desconocido", async () => {
    const statuses: [number, boolean, string][] = [[429, true, "none"], [529, true, "none"], [400, false, "none"], [401, false, "none"], [500, true, "unknown"]];
    for (const [status, retryable, billing] of statuses) {
      const { client } = fakeClient(() =>
        new Response(JSON.stringify({ type: "error", error: { type: "x", message: "m" } }), {
          status, headers: { "content-type": "application/json" },
        }),
      );
      await expect(new AnthropicModelClient(client).create({ ...base, model: "claude-haiku-5-5" })).rejects.toMatchObject({
        retryable,
        billing,
      });
    }
  });

  it("un motivo de parada desconocido no se trata como éxito", async () => {
    const { client } = fakeClient(() => message({ stop_reason: "model_context_window_exceeded" }));
    const r = await new AnthropicModelClient(client).create({ ...base, model: "claude-haiku-5-5" });
    expect(r.stopReason).toBe("other");
  });
});
