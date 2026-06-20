import { DfModal, TactileBtn } from "design-factory";

// DfModal portals to document.body and lays a fixed backdrop over the
// viewport — inside a preview card that's the card's own iframe, so an
// `open` modal fills the cell. cfg.overrides pins cardMode:single + a
// viewport so the open state renders in-cell instead of collapsing.
function Stage({
  theme = "dark",
  children,
}: {
  theme?: "dark" | "light";
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme={theme}
      style={{ background: "var(--df-bg-base)", width: "100%", height: "100%", minHeight: 420 }}
    >
      {children}
    </div>
  );
}

export function Confirm() {
  return (
    <Stage>
      <DfModal
        open
        onClose={() => {}}
        size="sm"
        title="Discard changes?"
        foot={
          <>
            <TactileBtn onClick={() => {}}>Cancel</TactileBtn>
            <TactileBtn onClick={() => {}}>Discard</TactileBtn>
          </>
        }
      >
        <p style={{ margin: 0, fontFamily: "var(--df-font-sans)", color: "var(--df-text-secondary)", lineHeight: 1.6 }}>
          You have unsaved edits on <strong style={{ color: "var(--df-text-primary)" }}>Aurora landing</strong>.
          Discarding will roll back to the last saved snapshot.
        </p>
      </DfModal>
    </Stage>
  );
}

export function FormDialog() {
  return (
    <Stage>
      <DfModal
        open
        onClose={() => {}}
        size="md"
        title="New project"
        foot={<TactileBtn onClick={() => {}}>Create project</TactileBtn>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "var(--df-font-sans)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--df-text-muted)" }}>
            Name
            <input
              defaultValue="Aurora landing"
              style={{
                padding: "9px 12px",
                background: "var(--df-bg-base)",
                border: "1px solid var(--df-border-subtle)",
                borderRadius: 6,
                color: "var(--df-text-primary)",
                fontFamily: "var(--df-font-sans)",
                fontSize: 13,
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.28)",
              }}
            />
          </label>
          <p style={{ margin: 0, fontSize: 12, color: "var(--df-text-faint)", lineHeight: 1.6 }}>
            A fresh workspace with its own canvas, chat history, and design system.
          </p>
        </div>
      </DfModal>
    </Stage>
  );
}
