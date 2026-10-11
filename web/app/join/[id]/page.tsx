"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Note } from "@/components/Note";
import { personOf } from "@/components/TabNote";
import { ErrorLine, SignInPanel, busyLabel, useAction } from "@/components/ui";
import { tillAbi } from "@/lib/abi";
import { TILL, explorerAddress, explorerTx, publicClient } from "@/lib/chain";
import { useHistory, useProfile, useTabs } from "@/lib/hooks";
import { useLive } from "@/lib/live";
import { CURRENCIES, currency, formatDuration, formatUsd, toUsd } from "@/lib/money";
import { relay } from "@/lib/relay";
import { codeToBytes3, isZero } from "@/lib/tabs";
import { useWallet } from "@/lib/wallet";
import styles from "./join.module.css";

/** A freelancer opens the link a client sent, signs in, says how they want to appear, and joins. */
export default function Join() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = useMemo(() => (/^\d+$/.test(params.id) ? BigInt(params.id) : null), [params.id]);
  const { views, profiles } = useTabs(id ? [id] : null, 4000);
  const wallet = useWallet();
  const mine = useProfile(wallet.address);
  const { rates } = useLive();
  const [key, setKey] = useState<Hex | null>(null);
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [cur, setCur] = useState("USD");
  const act = useAction();

  useEffect(() => {
    const m = window.location.hash.match(/k=([0-9a-fA-F]{64})/);
    setKey(m ? (`0x${m[1]}` as Hex) : null);
    // Guess the currency from the device's time zone (a language tag like en-GB says little about where someone lives); people can change it.
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const byZone: [RegExp, string][] = [
        [/^Asia\/(Kolkata|Calcutta)/, "INR"],
        [/^Asia\/Manila/, "PHP"],
        [/^Africa\/Lagos/, "NGN"],
        [/^America\/(Sao_Paulo|Bahia|Fortaleza|Recife|Manaus|Belem)/, "BRL"],
        [/^Africa\/Nairobi/, "KES"],
        [/^Asia\/Karachi/, "PKR"],
        [/^Asia\/(Jakarta|Makassar|Jayapura)/, "IDR"],
        [/^America\/(Mexico_City|Cancun|Monterrey|Tijuana|Merida|Chihuahua)/, "MXN"],
        [/^Europe\/London/, "GBP"],
        [/^Asia\/Singapore/, "SGD"],
        [/^Europe\//, "EUR"],
      ];
      const hit = byZone.find(([re]) => re.test(zone));
      if (hit) setCur(hit[1]);
    } catch {}
  }, []);
  useEffect(() => {
    if (mine?.name) {
      setName(mine.name);
      setPlace(mine.place);
      setCur(mine.currency || "USD");
    }
  }, [mine]);

  const view = views?.[0];
  const t = view?.tab;
  const { lines } = useHistory(id, t?.lastBlock, 4);
  const openedTx = lines?.find((l) => l.kind === "opened");
  if (!id) return <Shell>That isn&apos;t an invite link.</Shell>;
  if (!views) return <Shell busy />;
  if (!t || isZero(t.payer)) return <Shell>This tab doesn&apos;t exist. Check the link with the person who sent it.</Shell>;
  if (t.closed && isZero(t.payee)) return <Shell>The client closed this tab before anyone joined.</Shell>;
  if (!isZero(t.payee))
    return (
      <Shell>
        {t.closed ? "This tab has already been worked and closed." : "Someone has already joined this tab."}{" "}
        {wallet.address?.toLowerCase() === t.payee.toLowerCase() ? <Link href={`/tab/${id}`}>It&apos;s you: open it</Link> : t.closed ? <Link href={`/tab/${id}`}>See its pay stub</Link> : "Ask the client for a new link."}
      </Shell>
    );
  if (!key) return <Shell>This link is missing its invite code. Copy the whole link again, including the part after #.</Shell>;

  const payer = personOf(t.payer, profiles);
  const rateUsd = toUsd(t.rate);
  const hoursCovered = formatDuration((Number(t.budget) / Number(t.rate)) * 3600);
  const isPayer = wallet.address?.toLowerCase() === t.payer.toLowerCase();
  const problem = !name.trim() ? "Add your name so the client knows who's working." : null;

  const join = () =>
    act.run("Joined", async (sent) => {
      const me = wallet.address!;
      const digest = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "inviteDigest", args: [id, me] })) as Hex;
      const inviteSig = await privateKeyToAccount(key).signMessage({ message: { raw: digest } });
      if (!mine?.name || mine.name !== name.trim() || mine.place !== place.trim() || mine.currency !== cur) {
        await relay(wallet, "setProfile", [name.trim(), place.trim(), codeToBytes3(cur)]);
      }
      const p = relay(wallet, "claim", [id, inviteSig]);
      sent();
      const r = await p;
      router.push(`/tab/${id}`);
      return r;
    });

  return (
    <main className={`wrap ${styles.page}`}>
      <div className={styles.layout}>
        <div className={styles.copy}>
          <h1 className={styles.h1}>
            {payer.name} wants to pay you {formatUsd(rateUsd)} an hour, by the second.
          </h1>
          <p className={styles.lede}>
            {formatUsd(toUsd(t.budget))} is already waiting in the Till contract on Monad, enough for {hoursCovered} of work. Clock in when you
            start and your pay builds up every second. Cash out whenever you like.
          </p>
          <div className={styles.proof}>
            <p>
              <b>The money is already there.</b> {formatUsd(toUsd(t.budget))} sits in the{" "}
              <a href={explorerAddress(TILL)} target="_blank" rel="noreferrer">
                Till contract
              </a>{" "}
              on Monad, and the contract can only pay it to you for time on the clock or return it to {payer.name}.
              {openedTx && (
                <>
                  {" "}
                  <a className="serial" href={explorerTx(openedTx.hash)} target="_blank" rel="noreferrer">
                    See the deposit, block {openedTx.block.toLocaleString("en-US")}
                  </a>
                  .
                </>
              )}
            </p>
            <ul>
              <li>Clock in when you start; pay builds up every second.</li>
              <li>It reaches your wallet every few seconds while the tab is open, and you can cash out any time.</li>
              <li>No gas, no wallet app, no bank details.</li>
            </ul>
          </div>
          {isPayer ? (
            <p className="notice">This is your own tab. Send the link to the freelancer and they join from their browser.</p>
          ) : !wallet.address ? (
            <SignInPanel title="Sign in to join">
              <p>A passkey or your email is all you need. Till creates a wallet for you; you never need gas.</p>
            </SignInPanel>
          ) : (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (!problem) join();
              }}
            >
              <div className="field">
                <label htmlFor="j-name">Your name</label>
                <input id="j-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Nair" />
              </div>
              <div className="field">
                <label htmlFor="j-place">Your city</label>
                <input id="j-place" className="input" maxLength={40} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Pune" />
              </div>
              <div className="field">
                <label htmlFor="j-cur">Show my pay in</label>
                <select id="j-cur" className="input" value={cur} onChange={(e) => setCur(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn live" disabled={!!problem || act.busy}>
                {busyLabel(act.phase, "Join this tab")}
              </button>
              {problem && name !== "" && <p className="soft">{problem}</p>}
              <ErrorLine error={act.error} />
            </form>
          )}
        </div>
        <div className={styles.preview}>
          <Note
            id={id}
            usd={0}
            cur={currency(cur)}
            rates={rates}
            payee={{ name: name.trim() || "You", place: place.trim() || "your city" }}
            payer={{ name: payer.name, place: payer.place }}
            rateUsd={rateUsd}
            hours={0}
            live={false}
            status={`Ready for you to clock in, up to ${hoursCovered}`}
            engrave
          />
        </div>
      </div>
    </main>
  );
}

function Shell({ children, busy }: { children?: React.ReactNode; busy?: boolean }) {
  return (
    <main className={`wrap ${styles.page}`} aria-busy={busy}>
      {busy ? (
        <div className={`skeleton ${styles.skel}`} />
      ) : (
        <>
          <h1 className={styles.h1}>{children}</h1>
          <p className="soft">
            <Link href="/">Home</Link> · <Link href="/app">Your tabs</Link> · <Link href="/open">Open a tab</Link>
          </p>
        </>
      )}
    </main>
  );
}
