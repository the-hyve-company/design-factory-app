// ModalClose — the (X) button that lives in the top-right of every modal
// header. Was duplicated inline 4× across DsSetupModal, SkillImportModal,
// FullPromptModal, and the DFDS modal demo. Same anatomy each time:
// 26px square, subtle border, muted icon. Now a primitive.

interface Props {
  onClick: () => void;
  /** Override the title. Defaults to "Close". */
  title?: string;
}

export function ModalClose({ onClick, title = "Close" }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      title={title}
      style={style}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--df-interactive-hover)";
        e.currentTarget.style.color = "var(--df-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--df-text-muted)";
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <path d="M6 6l12 12M6 18L18 6" />
      </svg>
    </button>
  );
}

const style: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  background: "transparent",
  border: "1px solid var(--df-border-subtle)",
  color: "var(--df-text-muted)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  transition: "background 100ms ease, color 100ms ease",
  padding: 0,
};
