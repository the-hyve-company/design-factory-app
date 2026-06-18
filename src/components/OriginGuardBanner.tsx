// OriginGuardBanner — fatal-warning banner shown when the page is being
// served from an origin the daemon's CORS layer rejects (audit verdict
// Fase 1 #3). Persists across navigation; doesn't block the app — the
// user may want to read existing local-only data — but makes the
// misconfiguration explicit so chat persistence failures stop looking
// like chat bugs.
//
// Banner copy is intentionally Portuguese-first (user consumes pt-BR)
// with the technical detail (current origin + canonical list) in plain
// type so a copy/paste into terminal works.

import { useMemo } from "react";
import { checkCurrentOrigin } from "@/lib/origin-guard";

export function OriginGuardBanner() {
  const check = useMemo(() => checkCurrentOrigin(), []);

  if (check.ok) return null;
  // SSR / test environment without `window` — don't render the banner
  // there either; the test environment isn't a real browser.
  if (!check.currentOrigin) return null;

  const canonical = check.expectedOrigins[0] ?? "http://localhost:1420";

  return (
    <div className="origin-guard-banner" role="alert" aria-live="assertive">
      <div className="origin-guard-banner__title">Origem não permitida</div>
      <div className="origin-guard-banner__body">
        Esta página está em <code>{check.currentOrigin}</code>, mas o daemon do Design Factory só
        aceita conexões de <code>{canonical}</code> (ou pela app Tauri). Chamadas para o bridge vão
        falhar — chat, salvamento e geração ficam quebrados.
      </div>
      <div className="origin-guard-banner__cta">
        <a href={canonical} className="origin-guard-banner__link">
          Abrir em {canonical}
        </a>
      </div>
    </div>
  );
}
