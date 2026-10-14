import { afterEach, describe, expect, it, vi } from "vitest";

/** The CRE keeper read: HyperRPC is asked only up to its own head, never the public RPC's. */

vi.mock("@/lib/chain", async (original) => ({
  ...(await original<typeof import("@/lib/chain")>()),
  publicClient: {
    readContract: async ({ functionName }: { functionName: string }) => (functionName === "lastReportAt" ? 0n : 3n),
    // The public RPC is ahead of what HyperRPC has indexed.
    getBlockNumber: async () => 70_800_000n,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CRE logs over HyperRPC", () => {
  it("reads up to HyperRPC's head, and says why when HyperRPC fails", async () => {
    vi.stubEnv("ENVIO_API_TOKEN", "test-token");
    const calls: { method: string; params: unknown[] }[] = [];
    let fail = false;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body);
      calls.push({ method, params });
      if (fail) return new Response("busy", { status: 503 });
      const result = method === "eth_blockNumber" ? "0x4382b70" /* 70,790,000 */ : [];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });
    const { getCre } = await import("@/lib/cre");
    const cre = await getCre();
    expect(cre.source).toBe("envio-hyperrpc");
    const logs = calls.find((c) => c.method === "eth_getLogs")!;
    expect((logs.params[0] as { toBlock: string }).toBlock).toBe("0x4382b70");

    vi.resetModules();
    fail = true;
    const again = await (await import("@/lib/cre")).getCre();
    expect(again.source).toBe("rpc");
    expect(again.fallback).toMatch(/HTTP 503/);
    expect(JSON.stringify(again)).not.toContain("test-token");
  });
});
