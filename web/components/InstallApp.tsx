"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import styles from "./InstallApp.module.css";

/** Chrome's install event (not in TypeScript's DOM types). */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let setUp = false;

/**
 * Once per page load (called from the header, which every page has): register the service worker and keep Chrome's
 * install prompt for when someone presses "Install". The worker is production only, so development builds never
 * serve a cached page.
 */
export function usePwaSetup() {
  useEffect(() => {
    if (setUp) return;
    setUp = true;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e as InstallPromptEvent;
      emit();
    });
    window.addEventListener("appinstalled", () => {
      deferred = null;
      installed = true;
      emit();
    });
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const register = () => navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker", e));
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }
  }, []);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True when Segundo is running from a home screen icon rather than a browser tab. */
export function useStandalone() {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const read = () => setStandalone(mq.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return standalone;
}

type Platform = "ios" | "android" | "desktop" | null;

/** The Android app (a Trusted Web Activity around /app, built from till/android). */
const APK = "/segundo.apk";
const IPHONE = "On an iPhone, open Segundo in Safari, tap Share, then Add to Home Screen.";

function usePlatform(): Platform {
  const [p, setP] = useState<Platform>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    setP(ios ? "ios" : /Android/.test(ua) ? "android" : "desktop");
  }, []);
  return p;
}

/** The QR code itself, drawn as one SVG path in ink on note paper (always dark on light, so every camera reads it). */
function Qr({ text }: { text: string }) {
  const [path, setPath] = useState<{ d: string; n: number } | null>(null);
  useEffect(() => {
    let live = true;
    import("qrcode").then((QR) => {
      const m = QR.create(text, { errorCorrectionLevel: "M" }).modules;
      let d = "";
      for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
      if (live) setPath({ d, n: m.size + 4 });
    });
    return () => {
      live = false;
    };
  }, [text]);
  return (
    <div className={styles.qr}>
      {path ? (
        <svg viewBox={`0 0 ${path.n} ${path.n}`} role="img" aria-label="QR code that opens this page on your phone" shapeRendering="crispEdges">
          <rect width={path.n} height={path.n} fill="#F4F7F2" />
          <path d={path.d} fill="#17332B" />
        </svg>
      ) : (
        <div className={`skeleton ${styles.qrSkel}`} />
      )}
    </div>
  );
}

/**
 * "Install Segundo on your phone": the Android app download (plus Chrome's own install button where it offers one),
 * the Share-sheet steps on iPhone and iPad, and on a computer a QR code that opens this same page on a phone. Hidden
 * once running from the home screen or inside the Android app (both report display-mode standalone).
 */
export function InstallApp({ id }: { id?: string }) {
  const platform = usePlatform();
  const standalone = useStandalone();
  const prompt = useSyncExternalStore(
    subscribe,
    () => deferred,
    () => null,
  );
  const done = useSyncExternalStore(
    subscribe,
    () => installed,
    () => false,
  );
  const [here, setHere] = useState("");
  const [local, setLocal] = useState(false);
  useEffect(() => {
    // Path only: never put a #fragment (invite keys live there) into a QR code.
    setHere(`${location.origin}${location.pathname}`);
    setLocal(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname));
  }, []);

  if (!platform || standalone) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    deferred = null;
    emit();
  };

  return (
    <section className={styles.box} id={id} aria-labelledby="install-title">
      <div className={styles.text}>
        <h2 id="install-title">Install Segundo on your phone</h2>
        {done ? (
          <p>Installed. Open Segundo from your home screen.</p>
        ) : platform === "ios" ? (
          <>
            <p>Segundo works like an app from your home screen: full screen, one tap to your tabs.</p>
            <ol className={styles.steps}>
              <li>
                Tap <b>Share</b> <ShareIcon /> in Safari&rsquo;s toolbar.
              </li>
              <li>
                Choose <b>Add to Home Screen</b>.
              </li>
              <li>
                Tap <b>Add</b>. Segundo appears next to your other apps.
              </li>
            </ol>
          </>
        ) : platform === "android" ? (
          <>
            <p>Get the Segundo app for Android: full screen, one tap to your tabs.</p>
            <div className={styles.actions}>
              <a className="btn primary" href={APK} download>
                Download the Android app
              </a>
              {prompt && (
                <button className="btn quiet" onClick={install}>
                  Install from the browser
                </button>
              )}
            </div>
            <p className={styles.fine}>
              About 0.6 MB. Android asks once to allow installs from your browser. The app opens Segundo in Chrome, full screen.
            </p>
            {!prompt && (
              <p className={styles.fine}>
                Or add it from your browser&rsquo;s menu <b aria-label="three dots">&#8942;</b>: choose <b>Install app</b> or <b>Add to Home screen</b>.
              </p>
            )}
            <p className={styles.fine}>{IPHONE}</p>
          </>
        ) : (
          <>
            <p>Scan to open Segundo on your phone, then add it to your home screen.</p>
            <p className={styles.fine}>
              Sign in there with the same passkey and the same account opens: a passkey saved in Google Password Manager or iCloud Keychain is
              already on a phone that uses the same Google or Apple account.
            </p>
            {local && <p className={styles.fine}>This address only opens on this computer. On the live site the code opens Segundo on your phone.</p>}
            <div className={styles.actions}>
              <a className="btn small" href={APK} download>
                Download the Android app
              </a>
              {prompt && (
                <button className="btn small quiet" onClick={install}>
                  Install on this computer
                </button>
              )}
            </div>
            <p className={styles.fine}>{IPHONE}</p>
          </>
        )}
      </div>
      {platform === "desktop" && here && !done && (
        <figure className={styles.code}>
          <Qr text={here} />
          <figcaption>Scan to open Segundo on your phone</figcaption>
        </figure>
      )}
    </section>
  );
}

function ShareIcon() {
  return (
    <svg className={styles.share} viewBox="0 0 16 20" aria-hidden width="14" height="18">
      <path d="M8 1v11M4.5 4.5 8 1l3.5 3.5M5 8H2v11h12V8h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
