// NewProjectChatComposer.tsx — chat-style composer for the New Project
// modal.
//
// Mirrors EditorScreen's chat-input bar (file picker, mic with Web
// Speech API + MediaRecorder fallback, paste handler) but lives
// standalone so the modal doesn't depend on EditorScreen's internals.
// Attachments + links are typed directly into the prompt; there's no
// separate "context / references" panel.
//
// Image paste / drop:
//   - We can't write to disk yet (no projectPath until project exists), so
//     image attachments are buffered in-memory (data URLs + names) and the
//     host gets them via onAttachmentsChange. The host saves them under
//     `${projectPath}/.df-attachments/` after project creation.
//   - Non-image files (text, json, md, code) inline as text content.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useT } from "@/i18n";
import { AttachmentChips } from "@/components/AttachmentChips";

export interface ComposerAttachment {
  /** Original filename (sanitized for display). */
  name: string;
  /** Bytes. Same accounting as EditorScreen.handleAttach. */
  size: number;
  /** Mime type as reported by the browser. */
  mime: string;
  /** For images: data URL (kept in-memory until project exists, then host
   *  flushes to .df-attachments/). For text: file content inline. */
  content: string;
  /** Discriminator — host needs to know how to flush this on submit. */
  kind: "image" | "text" | "binary";
}

export interface NewProjectChatComposerProps {
  value: string;
  onChange: (next: string) => void;
  attachments: ComposerAttachment[];
  onAttachmentsChange: (next: ComposerAttachment[]) => void;
  /** Submit shortcut. Cmd/Ctrl+Enter fires this. */
  onSubmit?: () => void;
  placeholder?: string;
  /** rows hint for textarea — modal can pass smaller value at low viewport. */
  rows?: number;
  className?: string;
  /** v5: optional slot rendered in the right-hand side of the composer
   *  toolbar (after the hint span). Used by NewProjectFormSkeu to host the
   *  ModelRocker inside the prompt box footer. */
  toolbarRight?: ReactNode;
  /** optional slot rendered in the CENTER of the composer toolbar,
   *  replacing the "soltar · colar · arrastar" hint when present.
   *  Used by NewProjectFormSkeu to host the DS picker dropdown.
   *  When provided, the hint is suppressed and char-count/errors collapse
   *  into a smaller mono caption rendered below the DS picker.
   *  hint is also suppressed when `hideHint` is set — used when the
   *  toolbar has no center slot but user still wants empty space. */
  toolbarMid?: ReactNode;
  /** when true, the center hint ("soltar · colar · arrastar" / char
   *  count) is fully hidden. Errors still surface via the mini caption. */
  hideHint?: boolean;
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const TEXT_MAX_BYTES = 500 * 1024; // 500 kB

const TEXT_EXTENSIONS = /\.(md|ts|tsx|jsx|js|json|yml|yaml|txt|csv|html|css)$/i;
function isTextLike(mime: string, name: string): boolean {
  return (
    mime.startsWith("text/") ||
    /^application\/(json|javascript|xml|html)/.test(mime) ||
    TEXT_EXTENSIONS.test(name)
  );
}

async function fileToDataUrl(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Build base64 in chunks to dodge call-stack overflow on large files.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(bin);
  return `data:${f.type || "application/octet-stream"};base64,${b64}`;
}

export function NewProjectChatComposer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  onSubmit,
  placeholder,
  rows = 6,
  className,
  toolbarRight,
  toolbarMid,
  hideHint,
}: NewProjectChatComposerProps) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const recordingRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const baselineRef = useRef("");
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      void recordingRef.current?.stop();
    };
  }, []);

  const handleAttach = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const next: ComposerAttachment[] = [];
      for (const f of Array.from(files)) {
        const mime = f.type || "application/octet-stream";
        const isImage = mime.startsWith("image/");
        if (isImage) {
          if (f.size > IMAGE_MAX_BYTES) {
            setError(`${f.name} too large (>5MB)`);
            continue;
          }
          const dataUrl = await fileToDataUrl(f);
          next.push({ name: f.name, size: f.size, mime, content: dataUrl, kind: "image" });
        } else if (isTextLike(mime, f.name)) {
          if (f.size > TEXT_MAX_BYTES) {
            setError(`${f.name} too large (>500kb)`);
            continue;
          }
          const content = await f.text();
          next.push({ name: f.name, size: f.size, mime, content, kind: "text" });
        } else {
          if (f.size > TEXT_MAX_BYTES) {
            setError(`${f.name} too large (>500kb)`);
            continue;
          }
          const dataUrl = await fileToDataUrl(f);
          next.push({ name: f.name, size: f.size, mime, content: dataUrl, kind: "binary" });
        }
      }
      if (next.length === 0) return;
      onAttachmentsChange([...attachments, ...next]);
      setError(null);
    },
    [attachments, onAttachmentsChange],
  );

  const removeAttachment = useCallback(
    (idx: number) => {
      onAttachmentsChange(attachments.filter((_, i) => i !== idx));
    },
    [attachments, onAttachmentsChange],
  );

  // reorder via HTML5 drag-and-drop. The first chip is the
  // "principal" (primary canvas / first uploaded HTML); users reorder
  // by dragging chips before submitting.
  const reorderAttachment = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      if (fromIdx < 0 || toIdx < 0) return;
      if (fromIdx >= attachments.length || toIdx >= attachments.length) return;
      const next = attachments.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      onAttachmentsChange(next);
    },
    [attachments, onAttachmentsChange],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (const it of Array.from(items)) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return; // text paste flows through normally
      e.preventDefault();
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      await handleAttach(dt.files);
    },
    [handleAttach],
  );

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLTextAreaElement>) => {
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      await handleAttach(e.dataTransfer.files);
    },
    [handleAttach],
  );

  const startRecording = useCallback(async () => {
    if (isRecording) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      void recordingRef.current?.stop();
      return;
    }
    setError(null);
    // Prefer Web Speech API (realtime, free, in-browser).
    type SRConstructor = new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: {
        resultIndex: number;
        results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number };
      }) => void;
      onerror: (e: { error: string }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    const w = window as unknown as {
      SpeechRecognition?: SRConstructor;
      webkitSpeechRecognition?: SRConstructor;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (SR) {
      try {
        baselineRef.current = (textareaRef.current?.value ?? value).replace(/\s+$/, "");
        const r = new SR();
        r.continuous = true;
        r.interimResults = true;
        r.lang = "pt-BR";

        let finalText = "";

        r.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalText += t;
            else interim += t;
          }
          const baseline = baselineRef.current;
          const combined = (baseline ? baseline + " " : "") + (finalText + interim).trimStart();
          onChange(combined);
        };

        r.onerror = (e) => {
          if (e.error === "no-speech" || e.error === "aborted") return;
          setError(`Voice: ${e.error}`);
        };

        r.onend = () => {
          setIsRecording(false);
          recognitionRef.current = null;
        };

        recognitionRef.current = r;
        setIsRecording(true);
        r.start();
        return;
      } catch (e) {
        setError(`Voice setup failed: ${String(e).slice(0, 80)}`);
        return;
      }
    }
    // Fallback: MediaRecorder. We don't ship a Whisper bridge in this
    // surface — record the audio and append "[audio: filename]" as a
    // placeholder. User can switch to a Web Speech-capable browser.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        // Best-effort: append a placeholder line so the prompt knows audio
        // was attached. Real transcription needs a server hop we won't make
        // from this surface.
        const name = `audio-${Date.now()}.webm`;
        // Stuff the attachment in as a binary so the host can flush it.
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          onAttachmentsChange([
            ...attachments,
            { name, size: blob.size, mime: blob.type, content: dataUrl, kind: "binary" },
          ]);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      recordingRef.current = {
        stop: async () => {
          try {
            recorder.stop();
          } catch {
            /* ignore */
          }
          setIsRecording(false);
          recordingRef.current = null;
        },
      };
      setIsRecording(true);
      recorder.start();
    } catch (e) {
      setError(`Mic blocked: ${String(e).slice(0, 80)}`);
    }
  }, [attachments, isRecording, onAttachmentsChange, onChange, value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className={`np-composer${className ? ` ${className}` : ""}`}>
      {/* Attachment chips with drag-reorder + PRINCIPAL badge.
       *  See AttachmentChips.tsx for full behavior. */}
      <AttachmentChips
        attachments={attachments}
        onRemove={removeAttachment}
        onReorder={reorderAttachment}
      />

      {/* Textarea — hero of the composer. */}
      <textarea
        ref={textareaRef}
        className="np-composer-textarea cnp-prompt-textarea"
        placeholder={placeholder ?? t("composer.placeholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onKeyDown={handleKeyDown}
        rows={rows}
        spellCheck={false}
      />

      {/* Bottom toolbar — file picker + mic. */}
      <div className="np-composer-bar">
        <button
          type="button"
          className="np-composer-tool"
          title={t("composer.attach.title")}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21 12-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            void handleAttach(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          className={`np-composer-tool${isRecording ? " is-rec" : ""}`}
          title={isRecording ? t("composer.mic.stop") : t("composer.mic.start")}
          onClick={() => void startRecording()}
        >
          {isRecording ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          )}
        </button>

        <span className="np-composer-bar-spacer" />

        {toolbarMid ? (
          <span className="np-composer-bar-mid">{toolbarMid}</span>
        ) : !hideHint ? (
          <span className="np-composer-bar-hint">
            {error
              ? error
              : value.length > 0
                ? `${value.length} ${t("newproject.prompt.chars")}`
                : t("composer.hint.empty")}
          </span>
        ) : null}

        {(toolbarMid || hideHint) && (error || value.length > 0) && (
          <span className="np-composer-bar-mini" aria-live="polite">
            {error ? error : `${value.length} ${t("newproject.prompt.chars")}`}
          </span>
        )}

        <span className="np-composer-bar-spacer" />

        {toolbarRight && <span className="np-composer-bar-extra">{toolbarRight}</span>}
      </div>
    </div>
  );
}
