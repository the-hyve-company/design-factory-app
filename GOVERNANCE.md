# Governance

Design Factory is open-source. Anyone can fork, study, modify, and
ship a derivative under the [Apache 2.0 License](LICENSE). What
**this** repository — `design-factory` under
[THE-HYVE-COMPANY](https://github.com/THE-HYVE-COMPANY) — represents
is more specific: a single project with a single editorial direction,
maintained by The HYVE Company.

This file makes that boundary explicit.

---

## Who decides what

### Maintainers have final say on

- **Taste** — visual direction, default rules, taxonomies, the
  operational-taste thesis.
- **Architecture** — module structure, provider model, daemon
  boundary, sandbox posture.
- **Scope** — what belongs in the core and what becomes an
  extension or a fork.
- **Brand** — the HYVE and Design Factory wordmarks remain
  reserved (see [NOTICE](NOTICE) § Trademark notice).

### Contributors decide

- **Within an open PR or issue**: the change's own quality. We
  expect contributors to push back on review notes, propose
  alternatives, ask for context.
- **In their own fork**: anything. The Apache 2.0 grant covers
  full reuse + modification + redistribution, as long as forks
  rename themselves to honour the trademark boundary.

---

## How decisions move

Most changes go through GitHub:

1. **Issues** — anyone files. Maintainers triage with a label
   indicating intent: `accepts-pr`, `under-discussion`, `wontfix`,
   `out-of-scope`.
2. **Pull requests** — anyone opens. A maintainer reviews. If the
   change matches one of the architecture / taste / scope
   boundaries above and a maintainer disagrees, the PR can be
   closed with a one-paragraph rationale.
3. **Discussions** — for proposals that need shape before code.
   Open a thread; maintainers respond within a week when active.

When a change cuts across a boundary above (architecture / scope /
taste / brand), maintainer review decides whether it belongs in this
repository. We try to explain rather than just refuse, but ultimately
the project's editorial direction is not a vote.

---

## Roles

| Role            | Who                                           | What they can do                                                                            |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Steward**     | HYVE                                          | Final say on every dimension above. Merges to `main`.                                       |
| **Maintainer**  | HYVE staff or designated trusted contributors | Review + merge PRs that don't cross a boundary. Triage issues.                              |
| **Contributor** | Anyone with a PR or issue history             | Open PRs, file issues, comment on others. Earns trust by quality of contribution over time. |
| **User**        | Anyone running the app                        | Files bugs, requests features, joins discussions.                                           |

Roles are not formal seats. They describe what someone is doing
_right now_, not a job title.

---

## What stays out of scope

These choices are explicitly excluded from the project's direction:

- **Cloud sync.** Files live on disk. We do not run hosted
  inference, hosted projects, or hosted accounts.
- **Vector canvas.** The substance is HTML. We are not becoming a
  Figma replacement.
- **Marketplace / commerce mechanics.** No skill marketplace, no
  in-app purchases.
- **Provider lock-in.** Every adapter is replaceable. We will not
  privilege one provider's surface area over another's.

PRs that try to nudge the project toward any of the above will be
closed with a pointer to this section. Forks are welcome to make
different choices.

---

## Brand boundary

The [NOTICE](NOTICE) file scopes the Apache 2.0 grant to code and
documentation. The names "HYVE" and "Design Factory", their
wordmarks, and the project's logo are reserved.

If you fork the project:

- You can use the code under Apache 2.0.
- You **must rename your fork** to a name that doesn't include
  "HYVE" or "Design Factory" without modification (e.g. "DF Lite"
  is not OK; "Stencil Studio" is fine).
- You can reference the project in your README ("forked from
  Design Factory") — that's attribution, not branding.

---

## How HYVE communicates direction

Outside individual PRs, three channels carry direction:

- **`CHANGELOG.md`** — what shipped.
- **GitHub Discussions** — open-ended proposals and decisions in
  progress.

Decisions that become canon land in the codebase (a default rule, a
taxonomy entry, a config) rather than as a sticky issue.

---

## What this document deliberately doesn't say

- **A voting procedure.** We don't have one. If a decision warrants
  more than a single maintainer's call, it gets escalated to HYVE.
  We're not pretending the project is a foundation.
- **A maintainer ladder.** Becoming a maintainer happens by trust
  earned through contributions, not by application. We'll codify
  this if the project ever needs it.
- **A code of conduct.** That's in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

If something feels unclear or unfair, open an issue and tag it
`governance` — we'd rather refine this doc than have it become a
source of friction.
