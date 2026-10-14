import type { ReactNode } from "react";
import styles from "./StatePage.module.css";

/**
 * The page for a state rather than a task: a missing key, a used invite, a page that was never printed. Art on one side,
 * then what happened, what it means and where to go next, so the visitor is never left on bare paper.
 */
export function StatePage({
  eyebrow,
  title,
  lede,
  art,
  actions,
  children,
  titleId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  art?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  titleId?: string;
}) {
  return (
    <section className={`wrap ${styles.state}`} aria-labelledby={titleId}>
      <div className={styles.text}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1 id={titleId} className={styles.h1}>
          {title}
        </h1>
        {lede && <p className={styles.lede}>{lede}</p>}
        {children}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {art && (
        <div className={styles.art} aria-hidden>
          {art}
        </div>
      )}
    </section>
  );
}
