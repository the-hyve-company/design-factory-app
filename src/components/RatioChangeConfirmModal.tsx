/**
 * RatioChangeConfirmModal — confirmation dialog before triggering an
 * aspect-ratio regeneration. Approved-plan §4.2.
 *
 * Mandatory gate: every regen passes through this modal so the user
 * understands the cost (30s-2min stream, token spend) and can back out
 * before anything is destructive.
 */

import { DfModal } from "@/components/DfModal";
import type { RatioId } from "@/runtime/hyperframes-invoker";
import { RATIO_DIMS } from "@/runtime/ratio-regen";

interface Props {
  open: boolean;
  oldRatio: RatioId;
  targetRatio: RatioId;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RatioChangeConfirmModal({
  open,
  oldRatio,
  targetRatio,
  onCancel,
  onConfirm,
}: Props) {
  const oldDims = RATIO_DIMS[oldRatio];
  const newDims = RATIO_DIMS[targetRatio];

  return (
    <DfModal
      open={open}
      onClose={onCancel}
      size="md"
      title={`Mudar para ${targetRatio}?`}
      foot={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid var(--df-border-subtle)",
              color: "var(--df-text-primary)",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              borderRadius: "var(--df-r-md)",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              padding: "8px 14px",
              background: "var(--df-text-primary)",
              border: "1px solid var(--df-text-primary)",
              color: "var(--df-bg-base)",
              fontFamily: "var(--df-font-mono)",
              fontSize: "var(--df-text-xs)",
              fontWeight: 500,
              borderRadius: "var(--df-r-md)",
              cursor: "pointer",
            }}
          >
            Adaptar conteúdo
          </button>
        </div>
      }
    >
      <p
        style={{
          fontSize: "var(--df-text-sm)",
          color: "var(--df-text-primary)",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        O conteúdo atual foi gerado para <strong>{oldRatio}</strong> ({oldDims.label}). Para adaptar
        ao novo formato <strong>{targetRatio}</strong> ({newDims.label}), o Design Factory vai
        regenerar o HTML preservando texto, animações, cores e timing das scenes — apenas
        redimensionando o layout.
      </p>
      <p
        style={{
          fontSize: "var(--df-text-sm)",
          color: "var(--df-text-muted)",
          lineHeight: 1.6,
          marginTop: 12,
        }}
      >
        Esse processo demora 30s-2min e usa o provider/modelo selecionado. Você pode cancelar a
        qualquer momento.
      </p>
    </DfModal>
  );
}
