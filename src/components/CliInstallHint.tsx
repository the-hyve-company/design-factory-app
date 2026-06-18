// [DEPRECATED] CliInstallHint — only used by VercelPublishCard and
// GithubProviderCard, neither of which is part of the current public
// surface. File preserved (not deleted) for a future polished
// surface. Users authenticate via terminal directly when they need
// those flows.
//
// === ORIGINAL DOC (kept for future planning) =================================
//
// CliInstallHint.tsx — Disclosure showing install + login commands for
// Vercel and GitHub CLIs. Behaviour: when Settings surfaces Vercel /
// GitHub as "CLI identification", expanding this disclosure shows the
// commands the user needs to run in a terminal to install the CLIs.
//
// Anatomy (collapsed):
//   ⓘ Não tem o Vercel CLI? [Como instalar?]    (chevron right)
//
// Anatomy (expanded):
//   ⓘ Não tem o Vercel CLI? [Como instalar?]    (chevron down)
//   ─────────────────────────────────────────────
//   # Mac / Linux
//   $ npm install -g vercel               [copy]
//   $ vercel login                        [copy]
//
//   # Ou via Homebrew
//   $ brew install vercel-cli             [copy]
//
// Both providers use the same disclosure shell — only the command list
// changes per provider. Mirrors the editorial flat aesthetic of .

import { useState } from "react";
import { useT } from "@/i18n";

export type CliProvider = "vercel" | "github";

interface CliInstallHintProps {
  provider: CliProvider;
  /**
   * when true the disclosure starts expanded. Used in the
   * Providers redesign where CLI detection is the only path — no point
   * making the user click "Como instalar?" before they see the
   * commands they need to run.
   */
  defaultOpen?: boolean;
}

interface CliCommand {
  /** Optional caption above the command — e.g. "Mac / Linux". */
  caption?: string;
  /** The shell command (without leading `$`). */
  cmd: string;
}

const COMMANDS: Record<CliProvider, CliCommand[]> = {
  vercel: [
    { caption: "cli.install.caption.npm", cmd: "npm install -g vercel" },
    { cmd: "vercel login" },
    { caption: "cli.install.caption.brew", cmd: "brew install vercel-cli" },
  ],
  github: [
    { caption: "cli.install.caption.brew", cmd: "brew install gh" },
    { cmd: "gh auth login" },
    {
      caption: "cli.install.caption.linux",
      cmd: "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg",
    },
  ],
};

export function CliInstallHint({ provider, defaultOpen = false }: CliInstallHintProps) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const commands = COMMANDS[provider];

  const handleCopy = async (idx: number, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx(null), 1600);
    } catch {
      // Clipboard rejected (HTTP context, permissions). Silent fallback —
      // the cmd is already visible for manual copy.
    }
  };

  const triggerLabelKey = open ? "cli.install.hide" : "cli.install.show";
  const promptLabelKey =
    provider === "vercel" ? "cli.install.prompt.vercel" : "cli.install.prompt.github";

  return (
    <div className="cli-install-hint">
      <button
        type="button"
        className="cli-install-hint-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="cli-install-hint-icon" aria-hidden="true">
          ⓘ
        </span>
        <span className="cli-install-hint-prompt">{t(promptLabelKey)}</span>
        <span className="cli-install-hint-cta">
          {t(triggerLabelKey)}
          <span className="cli-install-hint-chev" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>
      {open && (
        <div className="cli-install-hint-body" role="region">
          {commands.map((c, idx) => (
            <div key={idx} className="cli-install-hint-cmd">
              {c.caption && <div className="cli-install-hint-caption">{t(c.caption)}</div>}
              <div className="cli-install-hint-cmd-row">
                <code>{c.cmd}</code>
                <button
                  type="button"
                  className="cli-install-hint-copy"
                  onClick={() => void handleCopy(idx, c.cmd)}
                  aria-label={t("cli.install.copy")}
                >
                  {copiedIdx === idx ? t("cli.install.copied") : t("cli.install.copy")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
