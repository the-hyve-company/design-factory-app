// AttachmentChips.tsx — visual chips for files attached to the
// NewProject modal composer.
//
// Behavior:
//   · Each attachment renders as a chip with kind icon + name + size + ✕.
//   · Multiple chips wrap horizontally (flex-wrap).
//   · The FIRST chip (index 0) carries the "PRINCIPAL" badge — when the
//     project is created, the first HTML attachment becomes the canvas's
//     index file (loaded as the primary preview). Remaining HTMLs land as
//     secondary canvas tabs (tab-N-…). Image attachments always land in
//     assets/. Text attachments stay inline in the seed prompt.
//   · HTML5-native drag-and-drop reorders chips (no external lib). The
//     dragged chip dims to 0.4 opacity; the drop target shows a 2px
//     accent-colored insertion bar on its leading edge. prefers-reduced-
//     motion suppresses the dim transition.
//
// This component is "dumb" in the React sense — all state lives in the
// host (NewProjectChatComposer / NewProjectFormSkeu). Reorder fires
// onReorder(fromIdx, toIdx); host calls Array.splice to commute.

import { useCallback, useState, type DragEvent } from "react";
import { useT, tf } from "@/i18n";
import type { ComposerAttachment } from "@/components/NewProjectChatComposer";

/** Detect whether the attachment is HTML (drives the badge label and
 *  the "primary canvas" hint). HTML is identified by mime OR filename
 *  extension to handle browsers that hand .html as application/octet-
 *  stream. The host uses the same predicate when distributing files. */
export function isHtmlAttachment(att: ComposerAttachment): boolean {
  if (att.mime === "text/html") return true;
  return /\.html?$/i.test(att.name);
}

function chipKindGlyph(att: ComposerAttachment): string {
  if (isHtmlAttachment(att)) return "▤"; // HTML — page glyph
  if (att.kind === "image") return "▦"; // image — grid
  if (att.kind === "text") return "≡"; // text — lines
  return "◇"; // binary — diamond
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

export interface AttachmentChipsProps {
  attachments: ComposerAttachment[];
  onRemove: (idx: number) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
}

export function AttachmentChips({ attachments, onRemove, onReorder }: AttachmentChipsProps) {
  const { t } = useT();
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (idx: number) => (e: DragEvent<HTMLSpanElement>) => {
      setDraggingIdx(idx);
      // Required for Firefox to actually start a drag operation.
      try {
        e.dataTransfer.setData("text/x-attachment-idx", String(idx));
        e.dataTransfer.effectAllowed = "move";
      } catch {
        /* ignore — some browsers throw on dataTransfer access */
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (idx: number) => (e: DragEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overIdx !== idx) setOverIdx(idx);
    },
    [overIdx],
  );

  const handleDragLeave = useCallback(
    (idx: number) => () => {
      if (overIdx === idx) setOverIdx(null);
    },
    [overIdx],
  );

  const handleDrop = useCallback(
    (idx: number) => (e: DragEvent<HTMLSpanElement>) => {
      e.preventDefault();
      const fromStr = e.dataTransfer.getData("text/x-attachment-idx");
      const fromIdx = fromStr ? Number(fromStr) : draggingIdx;
      setDraggingIdx(null);
      setOverIdx(null);
      if (fromIdx == null || Number.isNaN(fromIdx) || fromIdx === idx) return;
      onReorder(fromIdx, idx);
    },
    [draggingIdx, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingIdx(null);
    setOverIdx(null);
  }, []);

  if (attachments.length === 0) return null;

  return (
    <div className="np-composer-chips" role="list" aria-label={t("composer.attachments.list.aria")}>
      {attachments.map((att, idx) => {
        const isPrimary = idx === 0;
        const isHtml = isHtmlAttachment(att);
        const isDragged = draggingIdx === idx;
        const isOver = overIdx === idx && draggingIdx !== null && draggingIdx !== idx;
        const className = [
          "np-composer-chip",
          isPrimary ? "is-primary" : "",
          isHtml ? "is-html" : "",
          isDragged ? "is-dragged" : "",
          isOver ? "is-over" : "",
        ]
          .filter(Boolean)
          .join(" ");
        // Tooltip — surface the full filename + kind + (when primary)
        // canvas hint. User reads the chip; tooltip explains the role.
        const title =
          isPrimary && isHtml
            ? tf("composer.attachment.primaryHtml.title", att.name)
            : isPrimary
              ? tf("composer.attachment.primary.title", att.name)
              : att.name;

        return (
          <span
            key={`${att.name}-${idx}`}
            className={className}
            role="listitem"
            draggable={attachments.length > 1}
            onDragStart={handleDragStart(idx)}
            onDragOver={handleDragOver(idx)}
            onDragLeave={handleDragLeave(idx)}
            onDrop={handleDrop(idx)}
            onDragEnd={handleDragEnd}
            title={title}
            data-kind={att.kind}
            data-html={isHtml ? "true" : "false"}
            data-primary={isPrimary ? "true" : "false"}
          >
            {isPrimary && (
              <span className="np-composer-chip-badge" aria-hidden>
                {t("composer.attachment.primary.badge")}
              </span>
            )}
            <span className="np-composer-chip-kind" aria-hidden>
              {chipKindGlyph(att)}
            </span>
            <span className="np-composer-chip-name">{att.name}</span>
            <span className="np-composer-chip-size">{fmtSize(att.size)}</span>
            <button
              type="button"
              className="np-composer-chip-x"
              onClick={() => onRemove(idx)}
              aria-label={tf("composer.attachment.remove", att.name)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}
