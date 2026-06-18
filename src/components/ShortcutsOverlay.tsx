// ShortcutsOverlay — compact list of keyboard shortcuts. Triggered by `?`.
// Modal overlay; click outside or hit Esc / `?` again to dismiss.

import { DfModal } from "@/components/DfModal";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Group {
  title: string;
  rows: Array<[string, string]>;
}

const GROUPS: Group[] = [
  {
    title: "Transport",
    rows: [
      ["Space", "Play / pause"],
      ["←  / →", "Step ~33ms"],
      ["⇧ ←  / ⇧ →", "Jump 1s"],
    ],
  },
  {
    title: "Canvas",
    rows: [
      ["⌘ Z", "Undo"],
      ["⌘ ⇧ Z", "Redo"],
      ["⌘ K", "Command palette"],
    ],
  },
  {
    title: "Chat",
    rows: [
      ["Enter", "Send"],
      ["⇧ Enter", "Newline"],
      ["/", "Open command list"],
    ],
  },
  {
    title: "Help",
    rows: [
      ["?", "Toggle this overlay"],
      ["Esc", "Close any popover"],
    ],
  },
];

export function ShortcutsOverlay({ open, onClose }: Props) {
  return (
    <DfModal open={open} onClose={onClose} size="md" className="shortcuts-modal">
      <div className="shortcuts-head">
        <h2 className="shortcuts-title">Keyboard shortcuts</h2>
        <p className="shortcuts-sub">
          Press <kbd>?</kbd> anytime to toggle this list.
        </p>
      </div>
      <div className="shortcuts-grid">
        {GROUPS.map((g) => (
          <div key={g.title} className="shortcuts-group">
            <div className="shortcuts-group-title">{g.title}</div>
            <ul className="shortcuts-list">
              {g.rows.map(([keys, label]) => (
                <li key={keys} className="shortcuts-row">
                  <span className="shortcuts-keys">
                    {keys.split(" / ").map((k, i, arr) => (
                      <span key={k}>
                        {k.split(" ").map((part, j) => (
                          <kbd key={`${k}-${j}`}>{part}</kbd>
                        ))}
                        {i < arr.length - 1 && <span className="shortcuts-or">or</span>}
                      </span>
                    ))}
                  </span>
                  <span className="shortcuts-label">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </DfModal>
  );
}
