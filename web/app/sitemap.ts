import type { MetadataRoute } from "next";
import { tillAbi } from "@/lib/abi";
import { BENCH_TABS } from "@/lib/bench-addresses";
import { TILL, publicClient } from "@/lib/chain";
import { DEMO_FREELANCERS } from "@/lib/demo";

/** Pages are listed on segundo.world only: mera.segundo.world serves the same pages and is kept out of search. */
const SITE = "https://segundo.world";

/** Rebuilt once an hour, so new tabs show up without a deploy. */
export const revalidate = 3600;

type Entry = MetadataRoute.Sitemap[number];
const page = (path: string, priority: number, changeFrequency: Entry["changeFrequency"] = "weekly"): Entry => ({
  url: `${SITE}${path}`,
  changeFrequency,
  priority,
});

/**
 * Every public page: the product pages, the five demo freelancers' income statements, and every tab on chain except
 * the closed load-test tabs (see /network). Personal pages (your tabs, cash-out, claim and invite links) are left out.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    page("/", 1, "daily"),
    page("/open", 0.9),
    page("/send", 0.8),
    page("/request", 0.7),
    page("/business", 0.8),
    page("/network", 0.7, "daily"),
    page("/proof", 0.7),
    page("/keys", 0.6),
    page("/privy", 0.5),
    page("/deck", 0.5),
    ...DEMO_FREELANCERS.map((f) => page(`/proof/${f.address}`, 0.5, "daily")),
  ];
  try {
    const count = Number(await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "tabCount" }));
    for (let id = 1; id <= count; id++) {
      if (id >= BENCH_TABS.from && id <= BENCH_TABS.to) continue;
      entries.push(page(`/tab/${id}`, 0.4, "hourly"));
    }
  } catch {
    // The chain is unreachable: list the pages above and pick the tabs up on the next rebuild.
  }
  return entries;
}
