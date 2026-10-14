import type { ReactNode } from "react";
import styles from "./PageHead.module.css";

/**
 * One page head for every page that isn't the home page: a sentence-case eyebrow in serial red, the H1, a lede, and
 * optionally whatever the page needs right under them (a form, the buttons) and a piece of art on the right. On a phone
 * the art follows the text, capped small, so the heading is always the first thing read.
 */
export function PageHead({
  eyebrow,
  title,
  lede,
  art,
  children,
  compact,
  wideArt,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  art?: ReactNode;
  children?: ReactNode;
  /** A smaller H1, for task pages where the form below is the point (open a tab, your tabs). */
  compact?: boolean;
  /** Art that carries words (a specimen card): it keeps its width on a phone instead of shrinking to a vignette. */
  wideArt?: boolean;
  className?: string;
}) {
  return (
    <header className={`${styles.head} ${art ? styles.withArt : ""} ${compact ? styles.compact : ""} ${wideArt ? styles.wideArt : ""} ${className ?? ""}`}>
      <div className={styles.text}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.h1}>{title}</h1>
        {lede && <div className={styles.lede}>{lede}</div>}
        {children}
      </div>
      {art && <div className={styles.art}>{art}</div>}
    </header>
  );
}
