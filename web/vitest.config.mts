import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests for the server's money logic. The chain is a fake (test/fake-chain.ts): no network, no keys. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // Next.js refuses "server-only" outside a server bundle; under test it is an empty module.
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: {
      NEXT_PUBLIC_TILL_ADDRESS: "0xeb6c2c519c9bcc4495364c34ac116c20098113d1",
      NEXT_PUBLIC_FORWARDER_ADDRESS: "0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1",
      NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:9",
    },
  },
});
