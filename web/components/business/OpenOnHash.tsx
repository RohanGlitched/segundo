"use client";

import { useEffect } from "react";

/**
 * Opens a folded section when someone arrives at it by link (the contents row, the section navigator or a shared
 * URL), so a jump never lands on a closed box.
 */
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      const fold = el?.querySelector<HTMLDetailsElement>(":scope details");
      if (fold && !fold.open) fold.open = true;
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
