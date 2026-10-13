"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { explorerAddress } from "@/lib/chain";
import { formatUsd, toUsd } from "@/lib/money";
import sheet from "./SendSheet.module.css";
import styles from "./AddMoney.module.css";

/**
 * Money in, as a sheet over the wallet: the account's address on Monad with a QR code to scan from an exchange or
 * another wallet, a live line that notices when money lands, and the honest routes in: test AUSD here on testnet,
 * Agora (by bank wire) or an exchange on mainnet. Same shell as the send sheet, so it rises from the bottom on a phone.
 */
export function AddMoney({
  open,
  onClose,
  address,
  balance,
  onFaucet,
  faucetBusy,
  faucetError,
}: {
  open: boolean;
  onClose: () => void;
  address: Address;
  balance: bigint | null;
  onFaucet: () => void;
  faucetBusy: boolean;
  faucetError?: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // The balance when the sheet opened: anything above it arrived while the person was looking.
  const [base, setBase] = useState<bigint | null>(null);

  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!open) setBase(null);
    else if (base == null && balance != null) setBase(balance);
  }, [open, balance, base]);
  useEffect(() => {
    let stop = false;
    import("qrcode")
      .then((q) => q.toString(address, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17332bff", light: "#f4f7f2ff" } }))
      .then((svg) => !stop && setQr(svg))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [address]);

  const arrived = base != null && balance != null && balance > base ? balance - base : 0n;
  const copy = () =>
    navigator.clipboard
      ?.writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      })
      .catch(() => {});

  return (
    <dialog
      ref={ref}
      className={sheet.sheet}
      aria-labelledby="add-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className={sheet.inner} id="add-money">
        <header className={sheet.head}>
          <h2 id="add-title">Add money</h2>
          <button type="button" className={sheet.close} onClick={() => ref.current?.close()} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <section className={styles.receive} aria-labelledby="add-address">
          <div className={styles.qr} role="img" aria-label="QR code of your address" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
          <div className={styles.side}>
            <h3 id="add-address" className={styles.label}>
              Your address on Monad
            </h3>
            <p className={styles.how}>Send AUSD on Monad to this address from any wallet or exchange that supports Monad.</p>
            {/* The whole address, wrapped rather than cut off, so it can be checked character by character. */}
            <p id="add-addr" className={styles.addr} aria-label={`Your address: ${address}`}>
              {address}
            </p>
            <div className={styles.buttons}>
              <button type="button" className="btn small primary" onClick={copy}>
                {copied ? "Copied" : "Copy address"}
              </button>
              {canShare && (
                <button type="button" className="btn small" onClick={() => navigator.share({ title: "My Segundo address on Monad", text: address }).catch(() => {})}>
                  Share…
                </button>
              )}
              <a className="btn small quiet" href={explorerAddress(address)} target="_blank" rel="noreferrer">
                See it on MonadVision
              </a>
            </div>
          </div>
        </section>

        <p className={styles.careful}>
          <b>Only AUSD, only on the Monad network.</b> Another token, or AUSD sent on another network, won&apos;t show up here.
        </p>

        <p className={styles.watch} role="status" aria-live="polite" data-arrived={arrived > 0n ? "" : undefined}>
          {arrived > 0n ? (
            <>
              <b className="denom">+{formatUsd(toUsd(arrived))}</b> arrived. You now have {formatUsd(toUsd(balance!))}.
            </>
          ) : balance == null ? (
            "Reading your balance…"
          ) : (
            <>
              You have <b>{formatUsd(toUsd(balance))}</b>. Leave this open: money sent here shows up about a second after it lands on Monad.
            </>
          )}
        </p>

        <section className={styles.testnet} aria-labelledby="add-testnet">
          <div>
            <h3 id="add-testnet" className={styles.label}>
              On testnet
            </h3>
            <p>
              Segundo runs on Monad&apos;s test network, with test AUSD that isn&apos;t real money. Take 25 to try sending, opening a tab or cashing out.
            </p>
          </div>
          <button type="button" className="btn small primary" onClick={onFaucet} disabled={faucetBusy}>
            {faucetBusy ? "Sending test AUSD…" : "Get 25 test AUSD"}
          </button>
          {faucetError && <p className={styles.error}>{faucetError}</p>}
        </section>

        <section className={styles.mainnet} aria-labelledby="add-mainnet">
          <h3 id="add-mainnet" className={styles.label}>
            On mainnet
          </h3>
          <dl className={styles.routes}>
            <div>
              <dt>A business paying people</dt>
              <dd>
                Agora issues AUSD. A business with an Agora account wires US dollars from its bank and receives AUSD, and can redeem it back to dollars
                the same way. See{" "}
                <a href="https://www.agora.finance" target="_blank" rel="noreferrer">
                  agora.finance
                </a>
                .
              </dd>
            </div>
            <div>
              <dt>Anyone else</dt>
              <dd>
                Buy AUSD, or buy USDC and swap it for AUSD, on an exchange or app that supports Monad. Then withdraw to the address above and pick Monad
                as the network.
              </dd>
            </div>
            <div>
              <dt>Card or bank inside Segundo</dt>
              <dd>Needs a licensed on-ramp partner. None is signed yet, so this sheet doesn&apos;t offer it.</dd>
            </div>
          </dl>
        </section>
      </div>
    </dialog>
  );
}
