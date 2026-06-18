// CanvasStage — letterbox + intrinsic-size scaling for video projects.
//
// 2026-04-29 rewrite. The previous version sized the iframe to the
// letterbox dimensions and relied on wrapHtmlForViewportFit to force
// html/body to 100%/100%. That broke any HTML where the inner content
// was authored at fixed pixel coordinates (1080×1920 sections with
// absolute positioning, hardcoded font sizes in px) — the body shrank
// but the absolute children kept their original coords and blew past
// the viewport. Users reported "html cortado, todo quebrado".
//
// Correct pattern: render the iframe at the HTML's INTRINSIC viewport
// (1080×1920 for 9:16, 1920×1080 for 16:9, etc) and scale the iframe
// element with `transform: scale()` to fit the letterbox. Every pixel
// inside the iframe stays at design size — only the wrapper shrinks.
// Mirrors the HtmlPreviewCover pattern in ProjectCover.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  isVideoProject: boolean;
  /** Numeric aspect ratio (width / height). Drives the letterbox shape
   *  and resolves to an intrinsic viewport (1080×1920, 1920×1080, etc). */
  aspectNum: number;
  /** Optional ratio id; lets us pick the canonical pixel viewport for
   *  the format. Falls back to deriving from aspectNum. */
  ratioId?: "16:9" | "9:16" | "1:1" | "4k";
  onClick?: (e: React.MouseEvent) => void;
  cursor?: string;
}

function viewportForRatio(ratioId: Props["ratioId"], aspectNum: number): { w: number; h: number } {
  if (ratioId === "9:16") return { w: 1080, h: 1920 };
  if (ratioId === "1:1") return { w: 1080, h: 1080 };
  if (ratioId === "4k") return { w: 3840, h: 2160 };
  if (ratioId === "16:9") return { w: 1920, h: 1080 };
  // Derive: pick portrait if aspect < 1, square if ≈1, landscape otherwise.
  if (aspectNum < 0.95) return { w: 1080, h: Math.round(1080 / aspectNum) };
  if (aspectNum > 1.05) return { w: Math.round(1080 * aspectNum), h: 1080 };
  return { w: 1080, h: 1080 };
}

export function CanvasStage({
  children,
  isVideoProject,
  aspectNum,
  ratioId,
  onClick,
  cursor,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageDims, setStageDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageDims({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!isVideoProject) return null;
    const safeW = stageDims.w - 32;
    const safeH = stageDims.h - 32;
    if (safeW <= 0 || safeH <= 0) return { width: 0, height: 0, scale: 1, vw: 0, vh: 0 };
    let w = safeW;
    let h = w / aspectNum;
    if (h > safeH) {
      h = safeH;
      w = h * aspectNum;
    }
    const vp = viewportForRatio(ratioId, aspectNum);
    const scale = Math.min(w / vp.w, h / vp.h);
    return {
      width: Math.floor(w),
      height: Math.floor(h),
      scale,
      vw: vp.w,
      vh: vp.h,
    };
  }, [stageDims, aspectNum, ratioId, isVideoProject]);

  return (
    <div
      ref={stageRef}
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        minHeight: 0,
        cursor,
        background: isVideoProject ? "var(--df-bg-sunken)" : "white",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        padding: isVideoProject ? 16 : 0,
      }}
    >
      {isVideoProject && layout ? (
        <div
          style={{
            position: "relative",
            width: layout.width || "auto",
            height: layout.height || "auto",
            background: "white",
            borderRadius: "var(--df-r-md)",
            overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px var(--df-border-subtle)",
            visibility: layout.width > 0 ? "visible" : "hidden",
          }}
        >
          {/* Inner wrapper at the intrinsic viewport size, scaled to fit.
              Children are an iframe — we apply width/height/transform
              via the inline style below by cloning, but keeping a wrapper
              works for any child without React.cloneElement gymnastics. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: layout.vw,
              height: layout.vh,
              transform: `scale(${layout.scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex" }}>{children}</div>
      )}
    </div>
  );
}
