"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Footer } from "@/components/Footer";
import { Note } from "@/components/Note";
import { SignInPanel } from "@/components/ui";
import { useProfile } from "@/lib/hooks";
import { useLive } from "@/lib/live";
import { currency, formatDuration, formatMoney, formatUsd } from "@/lib/money";
import { REQUEST_LIMITS, cleanText, groupedAddress, requestLink, requestProblem } from "@/lib/request";
import { useWallet } from "@/lib/wallet";
import styles from "./request.module.css";

export default function RequestTab() {
  const wallet = useWallet();
  const me = wallet.address;
  const profile = useProfile(me);
  const { rates } = useLive();
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [rate, setRate] = useState("25");
  const [budget, setBudget] = useState("200");
  const [memo, setMemo] = useState("");
  const [origin, setOrigin] = useState("https://segundo.world");
  const [made, setMade] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  // The name on the account fills in once it loads, unless the person has started typing their own.
  useEffect(() => {
    if (!nameTouched && profile?.name) setName(profile.name);
  }, [profile?.name, nameTouched]);

  if (!wallet.ready) return <main className={`wrap ${styles.page}`} aria-busy="true" />;

  const rateN = Number(rate);
  const budgetN = Number(budget);
  const fields = { rate: rateN, budget: budgetN, memo: memo.trim(), from: name.trim() };
  const problem = requestProblem(fields);
  const covers = rateN > 0 && budgetN > 0 ? formatDuration((budgetN / rateN) * 3600) : "—";
  const cur = currency(profile?.currency || "USD");
  const first = cleanText(name, REQUEST_LIMITS.name).split(" ")[0] || "Your freelancer";
  const link = me && !problem ? requestLink(origin, { to: me, ...fields }) : null;

  return (
    <>
      <main className={`wrap ${styles.page}`}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>For freelancers</p>
          <h1 className={styles.h1}>Request a tab</h1>
          <p className={styles.lead}>
            Waiting for a client to set up payment is the slow part. Set your rate and a budget to suggest, and send your client one link. They check it,
            fund the tab, and you&apos;re paid every second you&apos;re clocked in. You pay nothing; Segundo&apos;s 1% comes from the client.
          </p>
        </header>

        {!me ? (
          <SignInPanel title="Sign in to request a tab">
            <p>The link carries your Segundo account&apos;s address, so your client&apos;s money can only go to you.</p>
          </SignInPanel>
        ) : (
          <div className={styles.layout}>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (link) setMade(link);
              }}
            >
              <div className="field">
                <label htmlFor="req-name">Your name, as your client knows you</label>
                <input
                  id="req-name"
                  className="input"
                  maxLength={REQUEST_LIMITS.name}
                  value={name}
                  autoComplete="name"
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                    setMade(null);
                  }}
                  placeholder="Tunde Bakare"
                />
              </div>
              <div className={styles.pair}>
                <div className="field">
                  <label htmlFor="req-rate">Your hourly rate</label>
                  <div className={styles.money}>
                    <span aria-hidden>$</span>
                    <input
                      id="req-rate"
                      className="input"
                      inputMode="decimal"
                      value={rate}
                      onChange={(e) => {
                        setRate(e.target.value);
                        setMade(null);
                      }}
                    />
                  </div>
                  <span className="hint">
                    {rateN > 0 && rates && cur.code !== "USD" ? `About ${formatMoney(rateN, cur, rates)} an hour at today's rate.` : "In AUSD, a digital US dollar."}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="req-budget">Suggested budget</label>
                  <div className={styles.money}>
                    <span aria-hidden>$</span>
                    <input
                      id="req-budget"
                      className="input"
                      inputMode="decimal"
                      value={budget}
                      onChange={(e) => {
                        setBudget(e.target.value);
                        setMade(null);
                      }}
                    />
                  </div>
                  <span className="hint">Covers {covers} of work. Your client can change it; whatever you don&apos;t work goes back to them.</span>
                </div>
              </div>
              <div className="field">
                <label htmlFor="req-memo">What it&apos;s for (optional)</label>
                <input
                  id="req-memo"
                  className="input"
                  maxLength={REQUEST_LIMITS.memo}
                  value={memo}
                  onChange={(e) => {
                    setMemo(e.target.value);
                    setMade(null);
                  }}
                  placeholder="Logo for the autumn launch"
                />
              </div>
              <div className={styles.submit}>
                <button className="btn primary" disabled={!!problem}>
                  Make my link
                </button>
                {problem && <span className={styles.why}>{problem}</span>}
              </div>

              {made && <ShareRequest link={made} name={cleanText(name, REQUEST_LIMITS.name)} rate={rateN} budget={budgetN} />}

              <p className={`soft ${styles.small}`}>
                Making a link signs nothing and costs nothing. Paid to <span className="serial">{groupedAddress(me)}</span>, the address of the account
                you&apos;re signed in with ({wallet.label}).
              </p>
            </form>

            <aside className={styles.preview} aria-label="What your client will see">
              <p className={styles.previewLabel}>What your client will see</p>
              <div className={styles.banner}>
                <b>{first} asked you to open this tab.</b>
                <span>
                  Paid to <span className="serial">{groupedAddress(me)}</span>. Check this matches what {first} sent you.
                </span>
              </div>
              <Note
                id={0}
                usd={0}
                cur={cur}
                rates={rates}
                payee={{ name: cleanText(name, REQUEST_LIMITS.name) || "You", place: profile?.place || "anywhere" }}
                payer={{ name: "Your client", place: "abroad" }}
                rateUsd={rateN > 0 ? rateN : 0}
                hours={0}
                live={false}
                status={rateN > 0 && budgetN > 0 ? `Ready to clock in, up to ${covers}` : "Set a rate and a budget"}
              />
            </aside>
          </div>
        )}

        <section className={styles.how} aria-labelledby="how-title">
          <h2 id="how-title" className={styles.h2}>
            How a request works
          </h2>
          <ol className={styles.steps}>
            <li>
              <b>You send the link.</b> On WhatsApp, by email, or as a QR code across the table. It holds your address, rate, budget and note, nothing else.
            </li>
            <li>
              <b>Your client checks it and funds the tab.</b> The open-a-tab form arrives filled in, with a line saying you asked and your address in full.
              They sign in with a passkey or email, change anything they like, and fund it with AUSD plus Segundo&apos;s 1%.
            </li>
            <li>
              <b>You clock in and are paid by the second.</b> The tab shows up in <Link href="/app">your tabs</Link>. Every few seconds what you&apos;ve earned
              lands in your account, on Monad, and you can <Link href="/cashout">cash it out to local money</Link>.
            </li>
          </ol>
          <p className="soft">
            A link is a suggestion, not a bill: nothing moves until your client signs. If someone edits the link on the way, the address your client sees
            changes too, which is why the form shows it in full and asks them to check it with you.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

/** The link, a QR code, and every way to send it on. */
function ShareRequest({ link, name, rate, budget }: { link: string; name: string; rate: number; budget: number }) {
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
  const who = name || "Your freelancer";
  const text = `${who} would like to work with you on Segundo at ${formatUsd(rate)} an hour, suggested budget ${formatUsd(budget, budget % 1 ? 2 : 0)}. You only pay for time worked, by the second. Open the tab here:`;
  const copy = () =>
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      })
      .catch(() => {});
  return (
    <div className={styles.share} role="status">
      <div className={styles.qr} aria-label="QR code of your link" role="img" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
      <div className={styles.shareSide}>
        <p>
          <b>Your link is ready.</b> Send it to your client.
        </p>
        <label className="visually-hidden" htmlFor="req-link">
          Your link
        </label>
        <input id="req-link" className={`input ${styles.linkField}`} readOnly value={link} onFocus={(e) => e.target.select()} />
        <div className={styles.shareButtons}>
          {canShare && (
            <button type="button" className="btn small primary" onClick={() => navigator.share({ title: `${who} asked you to open a Segundo tab`, text, url: link }).catch(() => {})}>
              Share…
            </button>
          )}
          <button type="button" className={`btn small ${canShare ? "" : "primary"}`} onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <a className="btn small" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="btn small" href={`mailto:?subject=${encodeURIComponent(`${who} asked you to open a Segundo tab`)}&body=${encodeURIComponent(`${text}\n\n${link}`)}`}>
            Email
          </a>
        </div>
      </div>
    </div>
  );
}
