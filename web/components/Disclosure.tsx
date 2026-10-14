"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import {
  DISCLOSURE_FIELDS,
  forgetVerifierRequest,
  openDisclosure,
  replyLink,
  requestLink,
  shareDetails,
  verifierRequest,
  type DisclosureField,
  type VerifiedDisclosure,
} from "@/lib/disclose";
import { hasSealedDetails } from "@/lib/seal";
import { shortAddress } from "@/lib/tabs";
import type { Wallet } from "@/lib/wallet";
import styles from "./Disclosure.module.css";

/** The part of the link after "#name=", read once on arrival. */
function fromHash(name: string): string | null {
  const m = window.location.hash.match(new RegExp(`${name}=([A-Za-z0-9_-]+)`));
  return m ? m[1]! : null;
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.copyRow}>
      <input className="input" readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} />
      <button
        type="button"
        className="btn small"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Qr({ value, label }: { value: string; label: string }) {
  const [qr, setQr] = useState<{ d: string; n: number } | null>(null);
  useEffect(() => {
    let live = true;
    import("qrcode")
      .then((QR) => {
        const m = QR.create(value, { errorCorrectionLevel: "L" }).modules;
        let d = "";
        for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
        if (live) setQr({ d, n: m.size + 4 });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [value]);
  return qr ? (
    <svg viewBox={`0 0 ${qr.n} ${qr.n}`} role="img" aria-label={label} shapeRendering="crispEdges" className={styles.qr}>
      <rect width={qr.n} height={qr.n} fill="#F4F7F2" />
      <path d={qr.d} fill="#17332B" />
    </svg>
  ) : (
    <div className={`skeleton ${styles.qr}`} />
  );
}

/* ---------------------------------------------------------------- verifier */

/**
 * For a landlord, bank or employer checking a statement: a one-time request key made in this browser, the link to send,
 * and the place the freelancer's reply opens.
 */
export function VerifierPanel({ address, onVerified }: { address: Address; onVerified: (v: VerifiedDisclosure | null) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<VerifiedDisclosure | null>(null);

  const open = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const v = await openDisclosure(address, text);
      setDone(v);
      onVerified(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    try {
      setCode(verifierRequest(address).code);
    } catch {
      setError("This browser can't keep a request key (storage is off). Use a normal window to ask for details.");
    }
    // A reply link opens straight away, also when it lands on this page while it is already open.
    const arrived = () => {
      const r = fromHash("reply");
      if (r) {
        setReply(r);
        void open(r);
      }
    };
    arrived();
    window.addEventListener("hashchange", arrived);
    return () => window.removeEventListener("hashchange", arrived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const link = code ? requestLink(address, code) : "";
  return (
    <section className={styles.panel} aria-labelledby="ask-title">
      <p className={styles.kicker}>For a landlord, a bank or an employer</p>
      <h2 id="ask-title">Ask for verified details</h2>
      <p className={styles.lede}>
        The totals on this statement come from Monad. To see who earned them, ask the account holder for their legal name, address, tax ID or payout
        account. They choose what to share; the reply opens only in this browser, and Segundo never sees it.
      </p>
      <div className={styles.steps}>
        <div className={styles.step}>
          <h3>1. Send them this link</h3>
          <p className="soft">Or let them scan the code with their phone, where their passkey is.</p>
          {link ? (
            <>
              <CopyRow value={link} label="Request link to send" />
              <div className={styles.codeLine}>
                <Qr value={link} label="QR code of the request link" />
                <p className="soft">
                  Request code <span className={`serial ${styles.code}`}>{code}</span>
                </p>
              </div>
            </>
          ) : (
            <div className={`skeleton ${styles.qr}`} />
          )}
        </div>
        <form
          className={styles.step}
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) void open(reply);
          }}
        >
          <h3>2. Open their reply here</h3>
          <label className="visually-hidden" htmlFor="reply">
            Their reply
          </label>
          <textarea
            id="reply"
            className={`input ${styles.area}`}
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Paste the link or reply they sent you"
          />
          <div className={styles.actions}>
            <button className="btn small primary" disabled={busy || !reply.trim()}>
              {busy ? "Checking…" : "Open and check"}
            </button>
            <button
              type="button"
              className="btn small quiet"
              onClick={() => {
                forgetVerifierRequest(address);
                setCode(verifierRequest(address, true).code);
                setReply("");
                setDone(null);
                setError(null);
                onVerified(null);
              }}
            >
              Start a new request
            </button>
          </div>
          {done && (
            <p className="notice ok" role="status">
              Checked: signed by this statement&apos;s account and readable only here. The details are on the statement below.
            </p>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
      <p className={styles.fine}>
        Your request key is made in this browser and never leaves it; a new request replaces it, and replies to the old one stop opening.{" "}
        <Link href="/keys#disclose">How this works</Link>
      </p>
    </section>
  );
}

/** What a verifier sees once a reply opens: on the statement itself, so it prints with it. */
export function VerifiedDetails({ v }: { v: VerifiedDisclosure }) {
  const d = v.details;
  const place = [d.postalAddress, d.country].filter(Boolean).join(", ");
  const rows: [string, string | undefined][] = [
    ["Legal name", d.legalName],
    ["Address", place || undefined],
    ["Tax ID", d.taxId],
    [d.payoutKind === "mobile" ? "Mobile money" : "Payout account", [d.payoutProvider, d.payoutAccount].filter(Boolean).join(", ") || undefined],
  ];
  const when = d.sharedAt ? new Date(d.sharedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <section className={styles.verified} aria-labelledby="verified-title">
      <h2 id="verified-title">Verified details for this statement</h2>
      <dl>
        {rows
          .filter(([, val]) => val)
          .map(([k, val]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
      </dl>
      <p className={styles.fine}>
        Shared {when && `on ${when} `}by the holder of account <span className="serial">{shortAddress(v.account)}</span>, checked against that account&apos;s
        signature, for this statement as read at block <span className="serial">{v.block.toLocaleString("en-US")}</span>. Opened in this browser only;
        Segundo never saw them. The totals below are read from Monad now.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- freelancer */

/** On your own statement: share the sealed details you pick with one verifier. */
export function ShareDetails({ address, wallet, block }: { address: Address; wallet: Wallet; block: number | null }) {
  const [shown, setShown] = useState(false);
  const [code, setCode] = useState("");
  const [fields, setFields] = useState<Set<DisclosureField>>(new Set(["legalName", "address"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const sealed = hasSealedDetails(address, wallet);

  useEffect(() => {
    const arrived = () => {
      const c = fromHash("verifier");
      if (c) {
        setCode(c);
        setShown(true);
      }
    };
    arrived();
    window.addEventListener("hashchange", arrived);
    return () => window.removeEventListener("hashchange", arrived);
  }, []);
  useEffect(() => {
    const drop = () => setLink(null);
    window.addEventListener("segundo:lock", drop);
    return () => window.removeEventListener("segundo:lock", drop);
  }, []);

  if (!shown)
    return (
      <div className={styles.shareClosed}>
        <button className="btn small" onClick={() => setShown(true)}>
          Share my sealed details with a verifier
        </button>
        <p className="soft">For a landlord or a bank: they see only what you pick, and only on their device.</p>
      </div>
    );

  const share = async () => {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      if (block == null) throw new Error("The statement is still loading. Try again in a moment.");
      const token = await shareDetails(wallet, { account: address, block: BigInt(block), verifierCode: code, fields: [...fields] });
      setLink(replyLink(address, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const text = link ? `Here are my verified details for my Segundo income statement. Open this on the device you asked from: ${link}` : "";
  return (
    <section className={styles.panel} aria-labelledby="share-title">
      <p className={styles.kicker}>Selective disclosure</p>
      <h2 id="share-title">Share sealed details with a verifier</h2>
      {!sealed ? (
        <p className={styles.lede}>
          Seal your legal name, address and tax ID on <Link href="/app#sealed">your account page</Link> first; then you can share any of them from here.
        </p>
      ) : (
        <form
          className={styles.shareForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void share();
          }}
        >
          <p className={styles.lede}>
            The verifier sent you a request link or code. What you pick is sealed for their browser only, tied to this statement, and signed by your account,
            so they know it came from you.
          </p>
          <div className="field">
            <label htmlFor="verifier-code">Their request link or code</label>
            <input id="verifier-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>
          <fieldset className={styles.fields}>
            <legend>What to share</legend>
            {DISCLOSURE_FIELDS.map((f) => (
              <label key={f.key}>
                <input
                  type="checkbox"
                  checked={fields.has(f.key)}
                  onChange={(e) => {
                    const next = new Set(fields);
                    if (e.target.checked) next.add(f.key);
                    else next.delete(f.key);
                    setFields(next);
                  }}
                />{" "}
                {f.label}
              </label>
            ))}
          </fieldset>
          <div className={styles.actions}>
            <button className="btn small primary" disabled={busy || !code.trim() || fields.size === 0}>
              {busy ? "Waiting for your passkey…" : "Seal for this verifier"}
            </button>
            <button type="button" className="btn small quiet" onClick={() => setShown(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {link && (
            <div className={styles.result} role="status">
              <p>
                <b>Send this back to the verifier.</b> Only their browser can open it.
              </p>
              <CopyRow value={link} label="Reply link to send" />
              <p className={styles.sendVia}>
                <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                  Send on WhatsApp
                </a>
                <a href={`mailto:?subject=${encodeURIComponent("My verified details")}&body=${encodeURIComponent(text)}`}>Send by email</a>
              </p>
            </div>
          )}
        </form>
      )}
      <p className={styles.fine}>
        Your passkey makes a disclosure key just for this, separate from the key that pays you and the one that seals your details.{" "}
        <Link href="/keys#disclose">How this works</Link>
      </p>
    </section>
  );
}

/** Someone opened a verifier's request link without being signed in as the statement's account. */
export function RequestNotice() {
  const [asked, setAsked] = useState(false);
  useEffect(() => setAsked(!!fromHash("verifier")), []);
  if (!asked) return null;
  return (
    <p className="notice">
      Someone asked to see sealed details for this statement. If it&apos;s yours, sign in with the passkey account it belongs to, then open the link again to
      choose what to share.
    </p>
  );
}
