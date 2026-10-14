"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, type Address } from "viem";
import { ErrorLine, LandedLine, busyLabel, useAction } from "@/components/ui";
import { explorerTx } from "@/lib/chain";
import { useLive } from "@/lib/live";
import { CURRENCIES, ago, currency, formatMoney, formatUsd, parseAmount, toUsd } from "@/lib/money";
import { cleanEmail, resolveRecipient } from "@/lib/recipient";
import { sendDollars, sweepFromKey, type Landed } from "@/lib/relay";
import {
  LINKS_CHANGED,
  claimLink,
  dropSentLink,
  linkBalance,
  linkBalances,
  newLinkKey,
  readSentLinks,
  saveSentLink,
  updateSentLink,
  type SentLink,
} from "@/lib/sendlink";
import { passkeyHint, useWallet, type Wallet } from "@/lib/wallet";
import styles from "./SendSheet.module.css";

type Mode = "link" | "contact" | "address";
const MODE_KEY = "segundo.send.mode";
const CUR_KEY = "segundo.send.cur";
const MIN = 10_000n; // $0.01, the smallest transfer the relayer sends

function remembered(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/**
 * Sending, as a sheet over the wallet: by link (the receiver needs nothing but the link and a passkey), to an email
 * address (a wallet Privy holds for that email, made now if needed) or to a wallet address. On a phone it rises from the bottom; on a wider screen it sits in the middle.
 */
export function SendSheet({
  open,
  onClose,
  balance,
  fromName,
  onMoved,
  onFaucet,
  faucetBusy,
}: {
  open: boolean;
  onClose: () => void;
  balance: bigint | null;
  fromName: string;
  onMoved: () => void;
  onFaucet: () => void;
  faucetBusy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("link");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const m = remembered(MODE_KEY, "link");
    setMode(m === "address" || m === "contact" ? m : "link");
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const pick = (m: Mode) => {
    setMode(m);
    remember(MODE_KEY, m);
  };
  const empty = balance != null && balance < MIN;
  const meraSite = useWallet().accounts === "mera";
  const shown: Mode = meraSite && mode === "contact" ? "link" : mode;

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby="send-title"
      onClose={onClose}
      onCancel={(e) => busy && e.preventDefault()}
      onClick={(e) => {
        // A tap on the dimmed backdrop closes the sheet, unless money is on its way.
        if (e.target === ref.current && !busy) ref.current?.close();
      }}
    >
      <div className={styles.inner} id="send">
        <header className={styles.head}>
          <h2 id="send-title">Send AUSD</h2>
          <button type="button" className={styles.close} onClick={() => ref.current?.close()} disabled={busy} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className={styles.modes} role="group" aria-label="How to send">
          <button type="button" aria-pressed={shown === "link"} onClick={() => pick("link")} disabled={busy}>
            By link
          </button>
          {/* The passkey-only site has no email sign-in, so a send to an email couldn't be collected there (as on /send). */}
          {!meraSite && (
            <button type="button" aria-pressed={mode === "contact"} onClick={() => pick("contact")} disabled={busy}>
              To an email
            </button>
          )}
          <button type="button" aria-pressed={mode === "address"} onClick={() => pick("address")} disabled={busy}>
            To a wallet address
          </button>
        </div>
        {empty && (
          <div className={styles.empty}>
            <p>
              <b>You don&apos;t have any AUSD to send yet.</b> Get 25 test AUSD (Agora&apos;s digital dollar on Monad&apos;s test network, not real
              money). It arrives in about a second.
            </p>
            <button type="button" className="btn small primary" onClick={onFaucet} disabled={faucetBusy}>
              {faucetBusy ? "Sending test AUSD…" : "Get 25 test AUSD"}
            </button>
          </div>
        )}
        {shown === "link" ? (
          <LinkForm max={balance ?? 0n} fromName={fromName} onMoved={onMoved} onBusy={setBusy} />
        ) : shown === "contact" ? (
          <ContactForm max={balance ?? 0n} fromName={fromName} onMoved={onMoved} onBusy={setBusy} />
        ) : (
          <AddressForm max={balance ?? 0n} onMoved={onMoved} onBusy={setBusy} />
        )}
      </div>
    </dialog>
  );
}

function amountProblem(value: bigint, max: bigint, typed: string): string | null {
  if (!typed) return "Enter an amount.";
  if (value <= 0n) return "Enter an amount in dollars, like 5 or 12.50.";
  if (value < MIN) return "The smallest amount is $0.01.";
  if (value > max) return `You have ${formatUsd(toUsd(max))}.`;
  return null;
}

/** Typed dollars to AUSD units, whole cents (shared parser, lib/money.ts: "2,5" is two and a half, "1e3" is refused). */
const toValue = (typed: string) => {
  const { units } = parseAmount(typed);
  return units == null ? 0n : units - (units % 10_000n);
};

/** "They receive about ₱56.20": the receiver's amount in their currency's ink. */
function Quote({ id, value, cur }: { id: string; value: bigint; cur: string }) {
  const { rates } = useLive();
  const c = currency(cur);
  const usd = toUsd(value);
  // Without today's rate (still loading, or the rates service is down) the quote stays in dollars rather than guessing.
  const hasRate = c.code === "USD" || !!rates?.[c.code];
  const quote = hasRate ? formatMoney(usd, c, rates) : formatUsd(usd);
  return (
    <div className={styles.quote} id={id} style={{ ["--q-ink" as string]: c.ink, ["--q-ink-night" as string]: c.inkNight }} aria-live="polite">
      <span className={styles.quoteLabel}>They receive about</span>
      <span className={`denom ${styles.quoteAmount}`}>{quote}</span>
      <span className={styles.quoteSub}>
        {value > 0n ? `${formatUsd(usd)} in AUSD` : "AUSD, a digital dollar"}
        {c.code === "USD" ? "" : hasRate ? ", at today's reference rate" : `; the ${c.name.toLowerCase()} rate hasn't loaded yet`}. No fee to send; Segundo
        pays the network cost.
      </span>
    </div>
  );
}

/** Amount in dollars and the receiver's currency, side by side. */
function AmountRow({ id, amount, setAmount, cur, setCur }: { id: string; amount: string; setAmount: (v: string) => void; cur: string; setCur: (v: string) => void }) {
  return (
    <div className={styles.row}>
      <div className="field">
        <label htmlFor={`${id}-amt`}>Amount in US dollars</label>
        <div className={styles.money}>
          <span aria-hidden>$</span>
          <input
            id={`${id}-amt`}
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-describedby={`${id}-quote`}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-cur`}>They spend</label>
        <select
          id={`${id}-cur`}
          className="input"
          value={cur}
          onChange={(e) => {
            setCur(e.target.value);
            remember(CUR_KEY, e.target.value);
          }}
        >
          {CURRENCIES.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name} ({x.symbol})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Passkey accounts: which sends ask for the passkey again (lib/wallet.tsx enforces it in the signer). Nothing for
 * email and practice wallets, whose sends are unchanged.
 */
function PasskeyNote({ wallet, value }: { wallet: Wallet; value: bigint }) {
  if (wallet.kind !== "mera") return null;
  return (
    <p className={styles.fine}>
      {passkeyHint(wallet, value) ?? "Up to $50 in all sends with no prompt while signing is unlocked; past that, Segundo asks for your passkey again."}
    </p>
  );
}

function LinkForm({ max, fromName, onMoved, onBusy }: { max: bigint; fromName: string; onMoved: () => void; onBusy: (b: boolean) => void }) {
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState("PHP");
  const [from, setFrom] = useState(fromName);
  const [made, setMade] = useState<{ link: string; rec: SentLink } | null>(null);
  const act = useAction();
  const sending = useRef(false);
  useEffect(() => setCur(remembered(CUR_KEY, "PHP")), []);
  useEffect(() => setFrom((f) => f || fromName), [fromName]);
  useEffect(() => onBusy(act.busy), [act.busy, onBusy]);

  const value = toValue(amount);
  const usd = toUsd(value);
  const problem = amountProblem(value, max, amount);

  const make = () => {
    const me = wallet.address;
    if (problem || !me || sending.current) return;
    sending.current = true;
    act.run("Link ready", async (sent) => {
      try {
        // The link's key is made here and saved before anything moves, so if the page closes mid-send the money can
        // still be taken back from the list of sent links.
        const { key, address } = newLinkKey();
        const rec: SentLink = { key, address, value: value.toString(), cur, from: from.trim(), at: Date.now(), state: "sending" };
        saveSentLink(me, rec);
        try {
          const p = sendDollars(wallet, address, value);
          sent();
          const r = await p;
          const done = { ...rec, state: "sent" as const, hash: r.hash, block: r.block };
          updateSentLink(me, address, { state: "sent", hash: r.hash, block: r.block });
          setMade({ link: claimLink(window.location.origin, done), rec: done });
          setAmount("");
          onMoved();
          return r;
        } catch (e) {
          // Nothing arrived at the link: forget it. If something did (a reply lost on the way back), keep it.
          const held = await linkBalance(address).catch(() => null);
          if (held === 0n) dropSentLink(me, address);
          else updateSentLink(me, address, { state: "sent" });
          throw e;
        }
      } finally {
        sending.current = false;
      }
    });
  };

  if (made)
    return (
      <div className={styles.made}>
        <p className={styles.madeLead}>
          <b>{formatUsd(toUsd(BigInt(made.rec.value)))} is waiting in this link.</b> Send it to the person you&apos;re paying. Whoever opens it first
          can collect it, so share it only with them. Until they do, you can take it back from &ldquo;Sent by link&rdquo;.
        </p>
        <LandedLine landed={act.landed} />
        <ShareLink link={made.link} rec={made.rec} />
        <div className={styles.foot}>
          <button type="button" className="btn quiet" onClick={() => setMade(null)}>
            Send another
          </button>
        </div>
      </div>
    );

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        make();
      }}
    >
      <p className={styles.lede}>They don&apos;t need a wallet or an app: they open the link and collect it with a passkey, in about a second.</p>
      <AmountRow id="link" amount={amount} setAmount={setAmount} cur={cur} setCur={setCur} />
      <Quote id="link-quote" value={value} cur={cur} />
      <div className="field">
        <label htmlFor="link-from">Your name on the link</label>
        <input id="link-from" className="input" maxLength={40} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Ana Reyes" autoComplete="name" />
        <span className="hint">So they know who it&apos;s from. It travels inside the link only.</span>
      </div>
      <div className={styles.foot}>
        <button className="btn primary" disabled={!!problem || act.busy}>
          {act.busy ? busyLabel(act.phase, "Create the link") : value > 0n ? `Create a ${formatUsd(usd)} link` : "Create the link"}
        </button>
        {problem && amount && <span className="soft">{problem}</span>}
      </div>
      <PasskeyNote wallet={wallet} value={value} />
      <ErrorLine error={act.error} />
    </form>
  );
}

/** The link, a QR code to scan across the table, and every way to send it on. */
export function ShareLink({ link, rec }: { link: string; rec: Pick<SentLink, "value" | "cur" | "from"> }) {
  const { rates } = useLive();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  useEffect(() => {
    let stop = false;
    import("qrcode")
      .then((q) => q.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17332bff", light: "#f4f7f2ff" } }))
      .then((svg) => !stop && setQr(svg))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [link]);
  const usd = toUsd(BigInt(rec.value));
  const c = currency(rec.cur);
  const local = c.code !== "USD" && rates ? ` (about ${formatMoney(usd, c, rates)})` : "";
  const text = `${rec.from || "Someone"} sent you ${formatUsd(usd)}${local} with Segundo. Open the link to collect it with a passkey; no app needed.`;
  const full = `${text} ${link}`;
  const copy = () =>
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      })
      .catch(() => {});

  return (
    <div className={styles.share}>
      <div className={styles.qr} aria-label="QR code of the link" role="img" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
      <div className={styles.shareSide}>
        <label className="visually-hidden" htmlFor={`link-${rec.value}-${link.slice(-8)}`}>
          The link
        </label>
        <input id={`link-${rec.value}-${link.slice(-8)}`} className={`input ${styles.linkField}`} readOnly value={link} onFocus={(e) => e.target.select()} />
        <div className={styles.shareButtons}>
          {canShare && (
            <button
              type="button"
              className="btn small primary"
              onClick={() => navigator.share({ title: "Money for you on Segundo", text, url: link }).catch(() => {})}
            >
              Share…
            </button>
          )}
          <button type="button" className={`btn small ${canShare ? "" : "primary"}`} onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <a className="btn small quiet" href={`https://wa.me/?text=${encodeURIComponent(full)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="btn small quiet" href={`sms:?&body=${encodeURIComponent(full)}`}>
            Text message
          </a>
          <a className="btn small quiet" href={`mailto:?subject=${encodeURIComponent("Money for you on Segundo")}&body=${encodeURIComponent(full)}`}>
            Email
          </a>
        </div>
        <p className={styles.fine}>The key to the money is in the part after #, which never reaches Segundo&apos;s server.</p>
      </div>
    </div>
  );
}

type Found = { address: Address; existing: boolean; email: string };

function ContactForm({ max, fromName, onMoved, onBusy }: { max: bigint; fromName: string; onMoved: () => void; onBusy: (b: boolean) => void }) {
  const wallet = useWallet();
  const { rates } = useLive();
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState("PHP");
  const [found, setFound] = useState<Found | null>(null);
  const [sentTo, setSentTo] = useState<(Found & { value: bigint; cur: string }) | null>(null);
  const look = useAction();
  const act = useAction();
  const sending = useRef(false);
  useEffect(() => setCur(remembered(CUR_KEY, "PHP")), []);
  useEffect(() => onBusy(act.busy || look.busy), [act.busy, look.busy, onBusy]);

  const email = cleanEmail(who);
  const value = toValue(amount);
  const usd = toUsd(value);
  const problem = !who.trim()
    ? "Enter their email address."
    : !email
      ? "Enter a full email address, like name@example.com."
      : found && found.address.toLowerCase() === wallet.address?.toLowerCase()
        ? "That's your own account."
        : amountProblem(value, max, amount);

  const submit = () => {
    if (problem || !email || sending.current) return;
    if (!found) {
      look.run("Found", async () => {
        const r = await resolveRecipient({ email });
        setFound({ ...r, email });
      });
      return;
    }
    sending.current = true;
    const to = found;
    act.run(`Sent ${formatUsd(usd)} to ${to.email}`, async (sent) => {
      try {
        const p = sendDollars(wallet, to.address, value);
        sent();
        const r = await p;
        setSentTo({ ...to, value, cur });
        setFound(null);
        setWho("");
        setAmount("");
        onMoved();
        return r;
      } finally {
        sending.current = false;
      }
    });
  };

  if (sentTo) {
    const c = currency(sentTo.cur);
    const sUsd = toUsd(sentTo.value);
    const local = c.code !== "USD" && rates ? ` (about ${formatMoney(sUsd, c, rates)})` : "";
    const site = typeof window === "undefined" ? "" : `${window.location.origin}/app`;
    const text = `${fromName || "I"} sent you ${formatUsd(sUsd)}${local} with Segundo. Choose "Continue with email" at ${site} with this email address and it's waiting for you.`;
    return (
      <div className={styles.made}>
        <p className={styles.madeLead}>
          <b>
            {formatUsd(sUsd)} is waiting for {sentTo.email}.
          </b>{" "}
          {sentTo.existing
            ? "They already have a Segundo account, so it's in their balance now."
            : "When they sign in to Segundo with this email address, it's there."}
        </p>
        <LandedLine landed={act.landed} />
        <div className={styles.tell}>
          <span>Let them know:</span>
          <a className="btn small" href={`mailto:${sentTo.email}?subject=${encodeURIComponent("Money for you on Segundo")}&body=${encodeURIComponent(text)}`}>
            Email them
          </a>
        </div>
        <div className={styles.foot}>
          <button type="button" className="btn quiet" onClick={() => setSentTo(null)}>
            Send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className={styles.lede}>Send to someone&apos;s email address. If they&apos;re new to Segundo, a wallet is made for that email and the money waits in it until they sign in.</p>
      <div className="field">
        <label htmlFor="who">Their email address</label>
        <input
          id="who"
          className="input"
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
            setFound(null);
            look.clearError();
          }}
          placeholder="ana@example.com"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <AmountRow id="contact" amount={amount} setAmount={setAmount} cur={cur} setCur={setCur} />
      <Quote id="contact-quote" value={value} cur={cur} />
      {found && (
        <p className="notice ok" role="status">
          {found.existing ? (
            <>
              <b>{found.email}</b> already has a Segundo account. The money lands in it straight away.
            </>
          ) : (
            <>
              They&apos;ll sign in to Segundo with <b>{found.email}</b> and the money will be waiting.
            </>
          )}
        </p>
      )}
      <div className={styles.foot}>
        <button className="btn primary" disabled={!!problem || act.busy || look.busy}>
          {look.busy
            ? "Finding their account…"
            : act.busy
              ? busyLabel(act.phase, "Send")
              : found
                ? `Send ${formatUsd(usd)} to ${found.email}`
                : "Continue"}
        </button>
        {problem && (who || amount) && <span className="soft">{problem}</span>}
      </div>
      <PasskeyNote wallet={wallet} value={value} />
      <ErrorLine error={look.error ?? act.error} />
    </form>
  );
}

function AddressForm({ max, onMoved, onBusy }: { max: bigint; onMoved: () => void; onBusy: (b: boolean) => void }) {
  const wallet = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const act = useAction();
  const sending = useRef(false);
  useEffect(() => onBusy(act.busy), [act.busy, onBusy]);
  const value = toValue(amount);
  const problem = !to
    ? "Paste the wallet address you want to send to."
    : !isAddress(to)
      ? "That isn't a wallet address. It starts with 0x and has 42 characters."
      : to.toLowerCase() === wallet.address?.toLowerCase()
        ? "That's your own wallet."
        : amountProblem(value, max, amount);
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (problem || sending.current) return;
        sending.current = true;
        act.run(`Sent ${formatUsd(toUsd(value))}`, async (sent) => {
          try {
            const p = sendDollars(wallet, to as Address, value);
            sent();
            const r = await p;
            // A sent form empties itself, so one more click can't send the money twice.
            setTo("");
            setAmount("");
            onMoved();
            return r;
          } finally {
            sending.current = false;
          }
        });
      }}
    >
      <p className={styles.lede}>For someone who already has a wallet on Monad, or an exchange deposit address that accepts AUSD on Monad.</p>
      <div className="field">
        <label htmlFor="to">Send to</label>
        <input id="to" className="input" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} autoComplete="off" spellCheck={false} />
        <span className="hint">You sign; Segundo pays the gas.</span>
      </div>
      <div className="field">
        <label htmlFor="amt">Amount in US dollars</label>
        <div className={styles.money}>
          <span aria-hidden>$</span>
          <input id="amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoComplete="off" />
        </div>
      </div>
      <div className={styles.foot}>
        <button className="btn primary" disabled={!!problem || act.busy}>
          {busyLabel(act.phase, "Send AUSD")}
        </button>
        {problem && (to || amount) && <span className="soft">{problem}</span>}
      </div>
      <PasskeyNote wallet={wallet} value={value} />
      <ErrorLine error={act.error} />
      <LandedLine landed={act.landed} />
    </form>
  );
}

/**
 * Links this browser has sent from the signed-in account: waiting, collected or taken back. A waiting link can be
 * shared again or taken back; taking back is the link's own key signing its whole balance back to the sender.
 */
export function SentLinks({ me, onMoved }: { me: Address; onMoved: () => void }) {
  const { rates } = useLive();
  const [links, setLinks] = useState<SentLink[]>([]);
  const [held, setHeld] = useState<Record<string, bigint | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [backing, setBacking] = useState<string | null>(null);
  const act = useAction();
  const moving = useRef(false);

  const load = useCallback(() => setLinks(readSentLinks(me).slice(0, 12)), [me]);
  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => e.key?.startsWith("segundo.links.v1.") && load();
    window.addEventListener(LINKS_CHANGED, load);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LINKS_CHANGED, load);
      window.removeEventListener("storage", onStorage);
    };
  }, [load]);

  // Balances are kept per link and state: when a link goes from sending to sent, a balance read before it landed
  // no longer counts, so a link that has just landed never shows as collected.
  const slot = (l: SentLink) => `${l.address.toLowerCase()}:${l.state}`;
  const watched = links.filter((l) => l.state !== "back");
  const watchKey = watched.map(slot).join(",");
  useEffect(() => {
    if (!watched.length) return;
    let stop = false;
    const read = () =>
      linkBalances(watched.map((l) => l.address)).then((bs) => {
        if (stop) return;
        setHeld((old) => {
          const next = { ...old };
          watched.forEach((l, i) => {
            if (bs[i] != null) next[slot(l)] = bs[i];
          });
          return next;
        });
      });
    read();
    const t = setInterval(read, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey]);

  if (!links.length) return null;

  const takeBack = (l: SentLink) => {
    if (moving.current) return;
    moving.current = true;
    act.run("Back in your wallet", async (sent) => {
      setBacking(l.address);
      try {
        const p = sweepFromKey(l.key, me);
        sent();
        const r: Landed = await p;
        updateSentLink(me, l.address, { state: "back", backHash: r.hash });
        setOpen(null);
        onMoved();
        return r;
      } finally {
        moving.current = false;
        setBacking(null);
      }
    });
  };

  return (
    <section className={styles.links} id="links" aria-labelledby="links-title">
      <h2 id="links-title">Sent by link</h2>
      <ul>
        {links.map((l) => {
          const a = l.address.toLowerCase();
          const left = held[slot(l)];
          const usd = toUsd(BigInt(l.value));
          const c = currency(l.cur);
          const status =
            l.state === "back"
              ? "Taken back"
              : left == null
                ? "Checking…"
                : left > 0n
                  ? "Waiting to be collected"
                  : l.state === "sending"
                    ? Date.now() - l.at < 180_000
                      ? "Sending…"
                      : "Didn't go through"
                    : "Collected";
          const waiting = l.state !== "back" && left != null && left > 0n;
          return (
            <li key={a} className={waiting ? styles.waiting : undefined}>
              <div className={styles.linkMain}>
                <span className={`denom ${styles.linkAmount}`}>{formatUsd(usd)}</span>
                <span className={styles.linkMeta}>
                  {c.code !== "USD" && rates ? `about ${formatMoney(usd, c, rates)}, ` : ""}
                  sent {ago((Date.now() - l.at) / 1000)}
                  {l.hash && (
                    <>
                      {" "}
                      <a className="serial" href={explorerTx(l.hash)} target="_blank" rel="noreferrer">
                        block {l.block?.toLocaleString("en-US")}
                      </a>
                    </>
                  )}
                </span>
              </div>
              <span className={styles.status} data-state={status === "Waiting to be collected" ? "waiting" : status === "Collected" ? "done" : "other"}>
                {status}
              </span>
              <div className={styles.linkActions}>
                {waiting && (
                  <>
                    <button type="button" className="btn small quiet" onClick={() => setOpen(open === a ? null : a)} aria-expanded={open === a}>
                      {open === a ? "Hide link" : "Share again"}
                    </button>
                    <button type="button" className="btn small" disabled={act.busy} onClick={() => takeBack(l)}>
                      {backing === l.address ? busyLabel(act.phase, "Take it back") : "Take it back"}
                    </button>
                  </>
                )}
                {status === "Didn't go through" && (
                  <button type="button" className="btn small quiet" onClick={() => dropSentLink(me, l.address)}>
                    Remove
                  </button>
                )}
              </div>
              {waiting && open === a && (
                <div className={styles.linkShare}>
                  <ShareLink link={claimLink(window.location.origin, l)} rec={l} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorLine error={act.error} />
      <LandedLine landed={act.landed} />
      <p className={styles.fine}>
        Links are remembered in this browser only. Anyone holding a link can collect it until you take it back, so send each one only to the person it&apos;s for.
      </p>
    </section>
  );
}
