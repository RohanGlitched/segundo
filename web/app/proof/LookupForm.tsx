"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { useWallet } from "@/lib/wallet";
import styles from "./lookup.module.css";

/** Paste an address (or a whole statement link) and open its statement. */
export function LookupForm() {
  const router = useRouter();
  const wallet = useWallet();
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className={styles.lookup}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          const found = value.trim().match(/0x[0-9a-fA-F]{40}/)?.[0];
          if (!found || !isAddress(found, { strict: false }))
            return setProblem("That doesn't look like a Monad address. It starts with 0x and has 40 more letters and digits.");
          setProblem(null);
          router.push(`/proof/${getAddress(found)}`);
        }}
      >
        <div className="field">
          <label htmlFor="proof-address">Account address</label>
          <input
            id="proof-address"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!problem}
            aria-describedby={problem ? "proof-problem" : undefined}
          />
        </div>
        <button className="btn primary">Open statement</button>
      </form>
      {problem && (
        <p id="proof-problem" className="notice error" role="alert">
          {problem}
        </p>
      )}
      {wallet.address && (
        <p className={styles.mine}>
          <Link href={`/proof/${wallet.address}`}>Open your own statement</Link>
        </p>
      )}
    </div>
  );
}
