import { ImageResponse } from "next/og";
import { markPaths } from "@/components/Mark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Tab icon: the smallest cut of the dial on a paper disc, so it reads on light and dark tab bars. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 32, height: 32, display: "flex" }}>
        <svg width="32" height="32" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50" fill="#EDF1EC" />
          {markPaths(0, "#17332B", "#C0266D")}
        </svg>
      </div>
    ),
    size,
  );
}
