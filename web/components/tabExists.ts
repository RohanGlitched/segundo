import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { tillAbi } from "@/lib/abi";
import { TILL, publicClient } from "@/lib/chain";

/** How many tabs the contract has opened, kept for a minute (as a string, so it caches). Null when Monad can't be reached. */
const readCount = unstable_cache(
  async (): Promise<string | null> => {
    try {
      return String((await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "tabCount" })) as bigint);
    } catch {
      return null;
    }
  },
  ["till-tab-count"],
  { revalidate: 60 },
);
const tabCount = async () => {
  const c = await readCount();
  return c == null ? null : BigInt(c);
};

/**
 * A tab address that can't name a tab answers with a real 404 (the friendly not-found page, with a 404 status).
 * A number just past the count is let through: a tab opened a moment ago may not have reached the node this server
 * asked, and its page waits for it.
 */
export async function requireTabId(id: string) {
  if (!/^\d{1,12}$/.test(id)) notFound();
  const count = await tabCount();
  if (count != null && BigInt(id) > count + 50n) notFound();
}
