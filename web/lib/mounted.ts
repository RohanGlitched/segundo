"use client";
import { useEffect, useState } from "react";

/**
 * True once the component is on the client. Decorative engraving below the fold is drawn after
 * mount, so the page's HTML carries only the notes a visitor sees first (the rosettes are long
 * SVG paths: twelve specimens and the closing rosette were two megabytes of markup).
 */
export function useMounted() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  return on;
}
