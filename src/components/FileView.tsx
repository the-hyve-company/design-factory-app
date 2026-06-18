import { useMemo } from "react";
import { CanvasStage } from "@/components/CanvasStage";
import { renderMarkdownSafe } from "@/lib/safe-markdown";

interface Props {
  name: string;
  path: string;
  content: string;
  isText: boolean;
}

// Detect the intrinsic viewport from html/body width/height in the source.
// Lets the FileView shrink the iframe with transform: scale() — same trick
// CanvasStage uses for the main canvas. Without this, opening a 1080×1920
// HTML through Files crops to 16:9 and only the top-left renders.
function detectIntrinsicViewport(
  html: string,
): { w: number; h: number; ratioId: "16:9" | "9:16" | "1:1" | "4k" } | null {
  // Look at the first html/body block — captures: html, body { width: NNNNpx; height: NNNNpx }
  const m =
    html.match(/html\s*,\s*body\s*\{[^}]*?width:\s*(\d+)px[^}]*?height:\s*(\d+)px/i) ??
    html.match(/body\s*\{[^}]*?width:\s*(\d+)px[^}]*?height:\s*(\d+)px/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 200 || h < 200) return null;
  // Map to canonical ids the CanvasStage knows.
  if (w === 1080 && h === 1920) return { w, h, ratioId: "9:16" };
  if (w === 1080 && h === 1080) return { w, h, ratioId: "1:1" };
  if (w === 3840 && h === 2160) return { w, h, ratioId: "4k" };
  if (w === 1920 && h === 1080) return { w, h, ratioId: "16:9" };
  // Custom dim — fall back to whichever bucket has the closest aspect.
  const ar = w / h;
  if (Math.abs(ar - 9 / 16) < 0.05) return { w, h, ratioId: "9:16" };
  if (Math.abs(ar - 1) < 0.05) return { w, h, ratioId: "1:1" };
  if (Math.abs(ar - 16 / 9) < 0.05) return { w, h, ratioId: "16:9" };
  return null;
}

export function FileView({ name, path, content, isText }: Props) {
  const ext = useMemo(() => name.toLowerCase().split(".").pop() ?? "", [name]);
  const intrinsic = useMemo(() => {
    if (ext !== "html" && ext !== "htm") return null;
    return detectIntrinsicViewport(content);
  }, [ext, content]);

  let body: React.ReactNode;

  if (!isText) {
    // Binary — show image inline, otherwise placeholder
    body = (
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "var(--df-bg-base)",
        }}
      >
        {/^data:image\//.test(content) ? (
          <img
            src={content}
            alt={name}
            style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain" }}
          />
        ) : (
          <div
            style={{
              fontSize: 12,
              color: "var(--df-text-faint)",
              fontFamily: "var(--df-font-mono)",
            }}
          >
            Binary file — preview unavailable
          </div>
        )}
      </div>
    );
  } else if (ext === "html" || ext === "htm") {
    // Audit P1.3 (post-#116 review): the previous combo
    // `allow-scripts allow-same-origin` is the most permissive sandbox
    // — scripts run AND have access to the parent's origin
    // (localStorage, cookies, IndexedDB). For a user-opened HTML file
    // we want the inverse: scripts run (so the page renders correctly
    // with animations / interactivity) but cannot escape into the
    // app's origin. `allow-scripts` alone forces a unique opaque
    // origin. Compare with src/runtime/runtime-p0.ts which already
    // uses this posture and documents it.
    const FILE_PREVIEW_SANDBOX = "allow-scripts";
    if (intrinsic) {
      const aspectNum = intrinsic.w / intrinsic.h;
      body = (
        <CanvasStage isVideoProject={true} aspectNum={aspectNum} ratioId={intrinsic.ratioId}>
          <iframe
            srcDoc={content}
            title={name}
            sandbox={FILE_PREVIEW_SANDBOX}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "white",
              display: "block",
            }}
          />
        </CanvasStage>
      );
    } else {
      body = (
        <iframe
          srcDoc={content}
          title={name}
          sandbox={FILE_PREVIEW_SANDBOX}
          style={{ flex: 1, width: "100%", border: "none", background: "white", minHeight: 0 }}
        />
      );
    }
  } else if (ext === "md" || ext === "markdown") {
    const html = renderMarkdownSafe(content, "");
    body = (
      <div
        className="chat-prose"
        style={{
          flex: 1,
          overflow: "auto",
          padding: "28px 44px",
          background: "var(--df-bg-base)",
          color: "var(--df-text-primary)",
          fontSize: 14,
          lineHeight: 1.7,
          maxWidth: 820,
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } else if (["json", "yml", "yaml"].includes(ext)) {
    // Pretty-print JSON
    let display = content;
    if (ext === "json") {
      try {
        display = JSON.stringify(JSON.parse(content), null, 2);
      } catch {}
    }
    body = renderCodeBlock(display);
  } else {
    body = renderCodeBlock(content);
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        minHeight: 0,
        flexDirection: "column",
        background: "var(--df-bg-base)",
      }}
    >
      <div
        style={{
          padding: "6px 14px",
          fontFamily: "var(--df-font-mono)",
          fontSize: 10,
          color: "var(--df-text-faint)",
          borderBottom: "1px solid var(--df-border-subtle)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
        title={path}
      >
        {path}
      </div>
      {body}
    </div>
  );
}

function renderCodeBlock(text: string) {
  return (
    <pre
      style={{
        margin: 0,
        flex: 1,
        overflow: "auto",
        padding: "14px 18px",
        fontFamily: "var(--df-font-mono)",
        fontSize: 12,
        lineHeight: 1.6,
        color: "var(--df-text-primary)",
        background: "var(--df-bg-base)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </pre>
  );
}
