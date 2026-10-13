"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./PageNav.module.css";

type Section = { el: HTMLElement; label: string };

/** Pages that draw their own navigation. */
const SKIP = ["/deck"];
/** A page needs a navigator once it has this many headed sections and runs past a few screens. */
const MIN_SECTIONS = 4;
const MIN_SCREENS = 3.2;

/** Headed sections of the page, outermost first; a section can name itself shorter with data-nav. */
function scan(): Section[] {
  const main = document.querySelector("main");
  if (!main) return [];
  const found: Section[] = [];
  for (const el of main.querySelectorAll<HTMLElement>("section")) {
    if (el.dataset.nav === "skip" || el.parentElement?.closest("main section")) continue;
    const label = el.dataset.nav || el.querySelector("h2")?.textContent?.trim();
    if (label && el.offsetHeight > 80) found.push({ el, label });
  }
  return found;
}

/**
 * Long pages get a seconds rail on wide screens (one tick per section, the one you're reading
 * longer and in serial red) and, everywhere, a dial in the corner that fills as you read and takes
 * you back to the top, with a list of sections beside it on narrower screens.
 */
export function PageNav() {
  const pathname = usePathname();
  const [sections, setSections] = useState<Section[]>([]);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const [shown, setShown] = useState(false);
  const [covering, setCovering] = useState(false);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Find the sections after each navigation, and again as the page's live parts fill in.
  useEffect(() => {
    setOpen(false);
    if (SKIP.some((p) => pathname.startsWith(p))) {
      setSections([]);
      return;
    }
    let timer = 0;
    const rescan = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = scan();
        const long = document.documentElement.scrollHeight > window.innerHeight * MIN_SCREENS;
        setSections(next.length >= MIN_SECTIONS && long ? next : []);
      }, 250);
    };
    rescan();
    const ro = new ResizeObserver(rescan);
    ro.observe(document.body);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [pathname]);

  // Track where the reader is.
  useEffect(() => {
    if (!sections.length) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
      setShown(window.scrollY > window.innerHeight * 0.5);
      const line = window.innerHeight * 0.35;
      let at = 0;
      sections.forEach((s, i) => {
        if (s.el.getBoundingClientRect().top <= line) at = i;
      });
      // At the very bottom the last section is the one being read, however short it is.
      if (max > 0 && window.scrollY >= max - 4) at = sections.length - 1;
      setActive(at);
      // On a phone the dock steps aside while it would sit on top of one of the page's own buttons.
      if (window.innerWidth < 720) {
        const top = window.innerHeight - 84;
        const left = window.innerWidth - 340;
        let over = false;
        for (const b of document.querySelectorAll<HTMLElement>("main .btn")) {
          const r = b.getBoundingClientRect();
          if (r.bottom > top && r.top < window.innerHeight && r.right > left) {
            over = true;
            break;
          }
        }
        setCovering(over);
      } else setCovering(false);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections]);

  // The section list closes on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>("[aria-current]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !toggleRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const smooth = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const go = useCallback(
    (i: number) => {
      const s = sections[i];
      if (!s) return;
      setOpen(false);
      s.el.scrollIntoView({ behavior: smooth() ? "smooth" : "auto", block: "start" });
      // Move focus with the reader, so keyboard and screen reader users land in the section too.
      const heading = s.el.querySelector<HTMLElement>("h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    },
    [sections],
  );
  const top = () => {
    window.scrollTo({ top: 0, behavior: smooth() ? "smooth" : "auto" });
    document.querySelector<HTMLElement>("main h1")?.setAttribute("tabindex", "-1");
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  };

  if (!sections.length) return null;

  // The dial: twelve ticks, a serial arc for how far you've read, and the seconds hand at that point.
  const R = 19;
  const C = 2 * Math.PI * R;
  const deg = progress * 360;
  const current = sections[active]?.label ?? "";

  return (
    <>
      <nav className={`${styles.rail} ${shown ? styles.on : ""}`} aria-label="Sections on this page">
        <ol style={{ ["--fill" as string]: sections.length > 1 ? active / (sections.length - 1) : 0 }}>
          {sections.map((s, i) => (
            <li key={`${i}-${s.label}`}>
              <button type="button" onClick={() => go(i)} aria-current={i === active ? "location" : undefined} className={styles.tick}>
                <span className={styles.label}>{s.label}</span>
                <span className={styles.mark} aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className={`${styles.dock} ${shown && !covering ? styles.on : ""}`}>
        {open && (
          <ul ref={listRef} className={styles.list} id="page-sections">
            {sections.map((s, i) => (
              <li key={`${i}-${s.label}`}>
                <button type="button" onClick={() => go(i)} aria-current={i === active ? "location" : undefined}>
                  <span className={styles.n} aria-hidden>
                    {i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          ref={toggleRef}
          type="button"
          className={styles.where}
          aria-expanded={open}
          aria-controls="page-sections"
          onClick={() => setOpen((o) => !o)}
          tabIndex={shown && !covering ? 0 : -1}
        >
          <span className="visually-hidden">Sections, now reading: </span>
          <span className={styles.whereText}>{current}</span>
          <span className={styles.count} aria-hidden>
            {active + 1}/{sections.length}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={open ? styles.flip : undefined}>
            <path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className={styles.dial} onClick={top} aria-label="Back to top" title="Back to top" tabIndex={shown && !covering ? 0 : -1}>
          <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
            <circle cx="24" cy="24" r="23" className={styles.face} />
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i * 30 * Math.PI) / 180;
              return (
                <line
                  key={i}
                  x1={24 + 21 * Math.sin(a)}
                  y1={24 - 21 * Math.cos(a)}
                  x2={24 + (i % 3 ? 19.5 : 18.5) * Math.sin(a)}
                  y2={24 - (i % 3 ? 19.5 : 18.5) * Math.cos(a)}
                  className={styles.dialTick}
                />
              );
            })}
            <circle
              cx="24"
              cy="24"
              r={R}
              className={styles.arc}
              strokeDasharray={`${C * progress} ${C}`}
              transform="rotate(-90 24 24)"
            />
            <line x1="24" y1="24" x2="24" y2="8" className={styles.hand} transform={`rotate(${deg} 24 24)`} />
            <circle cx="24" cy="24" r="8.5" className={styles.hub} />
            <path d="M20.5 25.5 24 22l3.5 3.5" className={styles.arrow} />
          </svg>
        </button>
      </div>
    </>
  );
}
