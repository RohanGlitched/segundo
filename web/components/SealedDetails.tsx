"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_DETAILS,
  canSeal,
  downloadSealedBackup,
  fetchSealed,
  readSealed,
  restoreSealedBackup,
  sealDetails,
  unsealDetails,
  uploadSealed,
  type SealedDetails as Details,
  type SealedEnvelope,
} from "@/lib/seal";
import { useWallet } from "@/lib/wallet";
import styles from "./SealedDetails.module.css";

const PROMISE =
  "Sealed with your passkey. Segundo keeps only the sealed copy, which it can't read; your details appear on your invoices and income statements only when you unlock them with your fingerprint, every time.";

const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * "Your private details": legal name, address, tax ID and payout account, kept only as ciphertext that this person's
 * passkey opens (lib/seal.ts). Unsealed values live in this component's state and are dropped when the session locks.
 */
export function SealedDetails() {
  const wallet = useWallet();
  // Read on the first render, not after it: the box then draws once at its final size (locked rows or the
  // "Add your details" offer) instead of growing by the redacted rows a moment after the page has settled.
  // Safe without a server render to match: this only renders for a signed-in wallet, which exists only in the browser.
  const [envelope, setEnvelope] = useState<SealedEnvelope | null>(() => readSealed(wallet.address));
  const [open, setOpen] = useState<Details | null>(null);
  const [draft, setDraft] = useState<Details | null>(null);
  const [busy, setBusy] = useState<"unseal" | "seal" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Whether Segundo's server holds this account's sealed copy: "kept", "none" (not found, or no server copies on this
  // deployment), or null while it's being checked.
  const [remote, setRemote] = useState<"kept" | "none" | null>(null);
  const sealable = canSeal(wallet);
  const unlocked = wallet.unlocked;

  const reread = useCallback(() => setEnvelope(readSealed(wallet.address)), [wallet.address]);
  useEffect(() => {
    reread();
    setOpen(null);
    setDraft(null);
    setRemote(null);
    window.addEventListener("segundo:sealed", reread);
    return () => window.removeEventListener("segundo:sealed", reread);
  }, [reread]);
  // A fresh browser has no copy of its own: fetch the server's (ciphertext; cached here and announced by "segundo:sealed").
  useEffect(() => {
    if (!wallet.address || !sealable) return;
    let live = true;
    void fetchSealed(wallet.address).then((e) => live && setRemote(e ? "kept" : "none"));
    return () => {
      live = false;
    };
  }, [wallet.address, sealable]);

  // Sealed in this browser before server copies existed: keep it there too, but only when that needs no passkey prompt.
  const kept = useRef(false);
  useEffect(() => {
    if (remote !== "none" || !envelope || !unlocked || kept.current) return;
    kept.current = true;
    void uploadSealed(wallet, envelope).then((ok) => ok && setRemote("kept"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, envelope, unlocked]);
  useEffect(() => {
    const drop = () => {
      setOpen(null);
      setDraft(null);
    };
    window.addEventListener("segundo:lock", drop);
    return () => window.removeEventListener("segundo:lock", drop);
  }, []);

  const attempt = async (which: "unseal" | "seal" | "restore", fn: () => Promise<void>) => {
    setError(null);
    setNote(null);
    setBusy(which);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const unseal = () =>
    attempt("unseal", async () => {
      setOpen(await unsealDetails(wallet));
    });

  const save = (d: Details) =>
    attempt("seal", async () => {
      const sealed = await sealDetails(wallet, d);
      setOpen({ ...d, updatedAt: new Date().toISOString() });
      setDraft(null);
      const ok = await uploadSealed(wallet, sealed);
      setRemote(ok ? "kept" : "none");
      setNote(
        ok
          ? "Sealed. The encrypted copy is also kept on Segundo's server, as ciphertext Segundo can't read: sign in with this passkey on any device and they open there."
          : "Sealed in this browser. To open them on another device or browser, download the sealed backup and restore it there with the same passkey.",
      );
    });

  const restore = (f: File) =>
    attempt("restore", async () => {
      if (f.size > 64_000) throw new Error("That file isn't a Segundo sealed backup.");
      const details = await restoreSealedBackup(wallet, await f.text());
      setOpen(details);
      const restored = readSealed(wallet.address);
      const ok = restored ? await uploadSealed(wallet, restored) : false;
      if (ok) setRemote("kept");
      setNote(ok ? "Restored from your backup, kept in this browser and on Segundo's server as ciphertext." : "Restored from your backup and kept in this browser.");
    });

  const backup = () => {
    setError(null);
    try {
      downloadSealedBackup(wallet.address!);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreButton = (
    <>
      <button className="btn small quiet" onClick={() => file.current?.click()} disabled={!!busy}>
        {busy === "restore" ? "Waiting for your passkey…" : "Restore a sealed backup"}
      </button>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void restore(f);
        }}
      />
    </>
  );

  // Email and practice wallets have no passkey to seal with: one line where the card would be, not a card they can't use.
  if (!sealable && wallet.kind !== "mera")
    return (
      <p className={styles.needs} id="sealed">
        Make a passkey account to seal your legal name and tax ID for invoices. <Link href="/keys">How sealing works</Link>
      </p>
    );

  return (
    <section className={styles.box} id="sealed" aria-labelledby="sealed-title">
      <header className={styles.head}>
        <SealMark />
        <div>
          <h2 id="sealed-title">Your private details</h2>
          <p className={styles.promise}>{PROMISE}</p>
        </div>
      </header>

      {!sealable ? (
        <p className={styles.needs}>
          Private details are sealed with a passkey, so they need a passkey account. Email and practice wallets can&rsquo;t seal them.
        </p>
      ) : draft ? (
        <DetailsForm draft={draft} setDraft={setDraft} busy={busy === "seal"} onSave={save} onCancel={() => setDraft(null)} />
      ) : open ? (
        <>
          <DetailsList d={open} />
          <div className={styles.actions}>
            <button className="btn small" onClick={() => setDraft(open)}>
              Edit
            </button>
            <button className="btn small quiet" onClick={backup}>
              Download sealed backup
            </button>
            <button className="btn small quiet" onClick={() => setOpen(null)}>
              Hide
            </button>
          </div>
        </>
      ) : envelope ? (
        <>
          <Redacted />
          <p className={styles.meta}>
            Sealed {when(envelope.sealedAt)}
            {remote === "kept" ? ", kept here and on Segundo’s server as ciphertext" : " in this browser"}. Opens with passkey <span className="serial">{envelope.credentialId.slice(0, 8)}</span>.
          </p>
          <div className={styles.actions}>
            <button className="btn small primary" onClick={unseal} disabled={!!busy}>
              {busy === "unseal" ? "Waiting for your passkey…" : "Unlock with your passkey"}
            </button>
            <button className="btn small quiet" onClick={backup} disabled={!!busy}>
              Download sealed backup
            </button>
            {restoreButton}
          </div>
          <p className={styles.policy}>Opening your details asks for your passkey every time, even while signing is unlocked.</p>
        </>
      ) : (
        <>
          <p className={styles.lede}>
            Your legal name, address, tax ID and where you cash out: what a client&rsquo;s accounts team asks for on every invoice. Seal them once; print them when
            you need them.
          </p>
          <div className={styles.actions}>
            <button className="btn small primary" onClick={() => setDraft({ ...EMPTY_DETAILS })} disabled={!!busy}>
              Add your details
            </button>
            {restoreButton}
          </div>
          <p className={styles.policy}>
            {remote === null
              ? "Looking for a sealed copy of your details…"
              : "Sealed them on another device? Signing in with the same passkey brings them here from Segundo's sealed copy; a backup file you downloaded restores them too."}
          </p>
        </>
      )}

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="notice ok" role="status">
          {note}
        </p>
      )}
      {sealable && (
        <p className={styles.fine}>
          AES-256-GCM in this browser, with a key your passkey derives on its own salt, kept apart from the key that signs your payments. The encrypted copy
          is kept in this browser and on Segundo&rsquo;s server, as ciphertext Segundo can&rsquo;t read, so any device you sign in on with the same passkey
          opens it; the backup file, the same ciphertext, still works without the server. Lose the passkey and the details can&rsquo;t be opened by
          anyone, including Segundo.
        </p>
      )}
      {sealable && (
        <p className={styles.fine}>
          <b>Why not your wallet key?</b> The wallet key signs every payment and could be exported as a recovery phrase; the sealing key comes from a
          different passkey salt and can&rsquo;t be worked out from it, so a leaked wallet key never opens your details.{" "}
          <Link href="/keys">One passkey, many keys</Link>
        </p>
      )}
    </section>
  );
}

function DetailsList({ d }: { d: Details }) {
  const rows: [string, string][] = [
    ["Legal name", d.legalName],
    ["Address", [d.postalAddress, d.country].filter(Boolean).join("\n")],
    ["Tax ID", d.taxId],
    [d.payoutKind === "mobile" ? "Mobile money" : "Bank account", [d.payoutProvider, d.payoutAccount].filter(Boolean).join(", ")],
  ];
  return (
    <dl className={styles.list}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v || <span className="soft">Not added</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Locked: the rows are there, printed over with security hatching, like the redacted block on a cheque. */
function Redacted() {
  return (
    <dl className={styles.list} aria-label="Sealed details, locked">
      {["Legal name", "Address", "Tax ID", "Payout account"].map((k, i) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            <span className={styles.hatch} style={{ width: `${[62, 84, 40, 70][i]}%` }} aria-hidden />
            <span className="visually-hidden">Sealed</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailsForm({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
}: {
  draft: Details;
  setDraft: (d: Details) => void;
  busy: boolean;
  onSave: (d: Details) => void;
  onCancel: () => void;
}) {
  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [k]: e.target.value });
  const mobile = draft.payoutKind === "mobile";
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.legalName.trim()) onSave(draft);
      }}
    >
      <div className="field">
        <label htmlFor="sd-name">Legal name</label>
        <input id="sd-name" className="input" value={draft.legalName} onChange={set("legalName")} autoComplete="off" required />
        <span className="hint">As it appears on your ID or tax registration.</span>
      </div>
      <div className="field">
        <label htmlFor="sd-tax">Tax ID</label>
        <input id="sd-tax" className="input" value={draft.taxId} onChange={set("taxId")} autoComplete="off" />
        <span className="hint">PAN, TIN, CPF, KRA PIN, or your country&rsquo;s equivalent.</span>
      </div>
      <div className={`field ${styles.wide}`}>
        <label htmlFor="sd-addr">Address</label>
        <textarea id="sd-addr" className={`input ${styles.area}`} rows={3} value={draft.postalAddress} onChange={set("postalAddress")} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="sd-country">Country</label>
        <input id="sd-country" className="input" value={draft.country} onChange={set("country")} autoComplete="off" />
      </div>
      <fieldset className={`${styles.kind} ${styles.wide}`}>
        <legend>Where you cash out</legend>
        <label>
          <input type="radio" name="sd-kind" checked={!mobile} onChange={() => setDraft({ ...draft, payoutKind: "bank" })} /> Bank account
        </label>
        <label>
          <input type="radio" name="sd-kind" checked={mobile} onChange={() => setDraft({ ...draft, payoutKind: "mobile" })} /> Mobile money
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor="sd-prov">{mobile ? "Provider" : "Bank"}</label>
        <input id="sd-prov" className="input" value={draft.payoutProvider} onChange={set("payoutProvider")} placeholder={mobile ? "M-Pesa, GCash, bKash…" : "Bank name"} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="sd-acct">{mobile ? "Mobile number" : "Account number or IBAN"}</label>
        <input id="sd-acct" className="input" value={draft.payoutAccount} onChange={set("payoutAccount")} inputMode={mobile ? "tel" : "text"} autoComplete="off" />
      </div>
      <div className={`${styles.actions} ${styles.wide}`}>
        <button className="btn primary" disabled={busy || !draft.legalName.trim()}>
          {busy ? "Waiting for your passkey…" : "Seal with your passkey"}
        </button>
        <button type="button" className="btn quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A wax-seal rosette in intaglio lines, the mark of something only its owner opens. */
function SealMark() {
  const rings = [22, 18, 14];
  return (
    <svg className={styles.mark} viewBox="0 0 56 56" aria-hidden>
      {rings.map((r, i) => (
        <circle key={r} cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeWidth={i === 0 ? 1.5 : 0.8} strokeDasharray={i === 1 ? "2 2" : undefined} />
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <ellipse key={i} cx={28 + Math.cos(a) * 8} cy={28 + Math.sin(a) * 8} rx="5" ry="2" transform={`rotate(${(a * 180) / Math.PI} ${28 + Math.cos(a) * 8} ${28 + Math.sin(a) * 8})`} fill="none" stroke="currentColor" strokeWidth="0.7" />;
      })}
      <rect x="23" y="27" width="10" height="8" rx="1.5" fill="var(--sheet)" stroke="currentColor" strokeWidth="1.4" />
      <path d="M25 27v-2.5a3 3 0 0 1 6 0V27" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
