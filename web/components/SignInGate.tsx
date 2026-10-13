"use client";

import type { ReactNode } from "react";
import { SignInPanel } from "./ui";
import styles from "./SignInGate.module.css";

export type GateStep = { title: ReactNode; body: ReactNode };

/**
 * The signed-out face of a page that needs an account: the ways in on the left, and on the right what the visitor
 * gets once they're in (a preview, then three numbered steps). Two columns on a desktop, stacked on a phone, so the
 * first thing anyone sees is never a lone card in an empty frame.
 */
export function SignInGate({
  title,
  level = 1,
  children,
  preview,
  steps,
  stepsTitle = "What happens next",
}: {
  title: string;
  /** 1 when the gate is the page's only heading, 2 under a page head of its own. */
  level?: 1 | 2;
  /** Lines under the title, inside the sign-in card. */
  children?: ReactNode;
  /** Shown above the steps: a note, a request's terms. */
  preview?: ReactNode;
  steps: GateStep[];
  stepsTitle?: string;
}) {
  const StepsHeading = level === 1 ? "h2" : "h3";
  return (
    <div className={styles.gate}>
      <div className={styles.panel}>
        <SignInPanel title={title} level={level}>
          {children}
        </SignInPanel>
      </div>
      <aside className={styles.aside} aria-label={stepsTitle}>
        {preview}
        <StepsHeading className={styles.stepsTitle}>{stepsTitle}</StepsHeading>
        <ol className={styles.steps}>
          {steps.map((s, i) => (
            <li key={i}>
              <span>
                <b>{s.title}</b> {s.body}
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
