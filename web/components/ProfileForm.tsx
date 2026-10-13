"use client";

import { useEffect, useState } from "react";
import { CURRENCIES, currency } from "@/lib/money";
import { relay } from "@/lib/relay";
import { PROFILE_SAVED } from "@/lib/hooks";
import { codeToBytes3, type Profile } from "@/lib/tabs";
import { useWallet } from "@/lib/wallet";
import { ErrorLine, LandedLine, busyLabel, useAction } from "./ui";
import styles from "./ProfileForm.module.css";

/** How your name, city and currency print on every note. Stored on chain so both sides see the same. */
export function ProfileForm({
  me,
  current,
  onSaved,
  startOpen,
  intro,
}: {
  me: string;
  current?: Profile;
  onSaved?: () => void;
  startOpen?: boolean;
  intro?: string;
}) {
  const wallet = useWallet();
  const [open, setOpen] = useState(!!startOpen);
  const [name, setName] = useState(current?.name ?? "");
  const [place, setPlace] = useState(current?.place ?? "");
  const [cur, setCur] = useState(current?.currency || "USD");
  const act = useAction();
  const [saved, setSaved] = useState<Profile | null>(null);
  const shown = saved ?? current;

  useEffect(() => {
    if (current?.name) {
      setName(current.name);
      setPlace(current.place);
      setCur(current.currency || "USD");
    } else if (current !== undefined || !me) setOpen(true);
  }, [current, me]);

  const problem = !name.trim() ? "Add the name clients will see." : name.length > 40 || place.length > 40 ? "Keep each under 40 characters." : null;

  // Still reading the profile: hold the one-line summary's place rather than flash the form and fold it up.
  if (!open && current === undefined && !saved && me)
    return (
      <p className={styles.summary} aria-busy="true">
        <span className="skeleton" style={{ display: "inline-block", width: "min(420px, 80%)", height: "1em", verticalAlign: "middle" }} />
      </p>
    );
  if (!open && shown?.name)
    return (
      <p className={styles.summary}>
        Your notes print <b>{shown.name}</b>
        {shown.place ? `, ${shown.place}` : ""}, with amounts in {currency(shown.currency).name} ({currency(shown.currency).symbol}).{" "}
        <button className={styles.edit} onClick={() => setOpen(true)}>
          Edit
        </button>
      </p>
    );

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) return;
        act.run("Saved", async (sent) => {
          const p = relay(wallet, "setProfile", [name.trim(), place.trim(), codeToBytes3(cur)]);
          sent();
          const r = await p;
          setSaved({ name: name.trim(), place: place.trim(), currency: cur });
          window.dispatchEvent(new Event(PROFILE_SAVED));
          onSaved?.();
          setOpen(false);
          return r;
        });
      }}
    >
      <p className={styles.intro}>{intro ?? "How should you appear on a tab? Freelancers see their pay in the currency they pick here."}</p>
      <div className={styles.grid}>
        <div className="field">
          <label htmlFor="pf-name">Name</label>
          <input id="pf-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="field">
          <label htmlFor="pf-place">City</label>
          <input id="pf-place" className="input" value={place} maxLength={40} onChange={(e) => setPlace(e.target.value)} placeholder="Your city" />
        </div>
        <div className="field">
          <label htmlFor="pf-cur">Show amounts in</label>
          <select id="pf-cur" className="input" value={cur} onChange={(e) => setCur(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.symbol})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.foot}>
        <button className="btn primary" disabled={!!problem || act.busy}>
          {busyLabel(act.phase, "Save")}
        </button>
        {shown?.name && (
          <button type="button" className="btn quiet" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
        {problem && name && <span className="soft">{problem}</span>}
      </div>
      <ErrorLine error={act.error} />
      <LandedLine landed={act.landed} />
    </form>
  );
}
