"use client";

import { useState } from "react";
import styles from "@/app/open/open.module.css";

export function InviteBox({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const text = `I've opened a Segundo tab for you: you're paid every second you work. Join here: ${link}`;
  return (
    <div className={styles.invite}>
      <p>
        <b>Send this link to your freelancer.</b> It works once, for the first person who joins with it.
      </p>
      <div className={styles.linkRow}>
        <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
        <button
          className="btn primary"
          onClick={() => {
            navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className={styles.share}>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          Send on WhatsApp
        </a>
        <a href={`mailto:?subject=${encodeURIComponent("Your Segundo tab")}&body=${encodeURIComponent(text)}`}>Send by email</a>
      </p>
    </div>
  );
}
