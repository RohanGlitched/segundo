"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/lib/live";
import { currency } from "@/lib/money";
import { Note } from "../Note";
import styles from "./home.module.css";

/** Where each feature sits on the note, in percent of its width and height. */
const PARTS = [
  { key: "serial", x: 89, y: 11, title: "Serial", body: "The tab's number, printed in serial red like a banknote's." },
  { key: "rosette", x: 21, y: 26, title: "Rosette", body: "A band is engraved for each stretch of work: two minutes, then five, ten, twenty, up to two hours. The red band is printing now." },
  { key: "monogram", x: 26.5, y: 50, title: "Monogram", body: "The freelancer's initials, where a banknote has a portrait." },
  { key: "amount", x: 66, y: 34, title: "Value", body: "What's been earned so far, in the freelancer's own currency, rolling every second." },
  { key: "ink", x: 3, y: 60, title: "Ink", body: "Each currency prints in its own colour, the way each denomination does." },
  { key: "micro", x: 40, y: 89.5, title: "Microprint", body: "Both names and the serial, repeated too small to read without a closer look." },
  { key: "block", x: 63, y: 81, title: "Block", body: "The Monad block the note was last read at, ticking several times a second." },
];

export function NoteAnatomy() {
  const { rates, head } = useLive();
  const [active, setActive] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(17.4);
  // A slow, honest specimen: the amount moves at the stated rate so the parts can be seen working.
  useEffect(() => {
    const t = setInterval(() => setMinutes((m) => (m > 180 ? 17.4 : m + 1 / 60)), 1000);
    return () => clearInterval(t);
  }, []);
  const rate = 36;

  return (
    <div className={styles.anatomy}>
      <div className={styles.anatomyNote}>
        <Note
          id={128}
          usd={(minutes / 60) * rate}
          cur={currency("INR")}
          rates={rates}
          payee={{ name: "Priya Nair", place: "Pune" }}
          payer={{ name: "Northwind Studio", place: "Berlin" }}
          rateUsd={rate}
          hours={minutes / 60}
          live
          status={`Specimen: on the clock for ${Math.floor(minutes)} min`}
          serialLine={`block ${head ? head.number.toLocaleString("en-US") : "…"}, a specimen note`}
        />
        {PARTS.map((p) => (
          <span
            key={p.key}
            className={`${styles.pin} ${active === p.key ? styles.pinOn : ""}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            aria-hidden
          />
        ))}
      </div>
      <ul className={styles.parts}>
        {PARTS.map((p) => (
          <li key={p.key}>
            <button
              className={styles.part}
              onMouseEnter={() => setActive(p.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive(null)}
              aria-pressed={active === p.key}
            >
              <b>{p.title}</b>
              <span>{p.body}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
