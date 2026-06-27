# Privacy

Design Factory is **local-first**. It runs entirely on your machine: a
React app on `localhost` talking to a Node daemon on `localhost`. There
is no Design Factory server, no account, and no sign-up.

## No telemetry

Design Factory ships with **zero telemetry**:

- No analytics, no usage tracking, no event collection.
- No crash/error reporting to any third party.
- No "phone home", no background update pings, no remote config.

There are no analytics or telemetry libraries in the dependency tree,
and the daemon binds to loopback (`127.0.0.1`) only. We do not collect,
store, or transmit anything about how you use the app.

## What stays on your machine

Everything, by default:

- **Projects** — your generated HTML/assets live under `projects/{slug}/`.
- **Chat and snapshots** — conversation history and per-project version
  snapshots live in the gitignored `.df/` metadata folder.
- **Settings** — taxonomies, rules, taste dials, and preferences are
  stored locally.
- **API keys (BYOK)** — provider keys you enter are stored locally and
  are never sent anywhere except, directly, to the provider they belong
  to.

## What leaves your machine — only when you act

Design Factory only makes a network request as a direct result of
something you do:

- **Generating with a cloud provider.** When you run a turn against a
  cloud provider (Anthropic, OpenAI, Gemini, OpenRouter, or a CLI agent
  that calls a cloud model), your prompt and the relevant project
  context are sent **directly to that provider, using your own key**.
  That data is then governed by **that provider's** privacy policy, not
  ours. If you run a **local** model (Ollama), nothing leaves your
  machine at all.
- **Deploying to Vercel** (optional). If you use the deploy feature,
  Design Factory talks to Vercel on your behalf, using **your** Vercel
  account, to publish what you chose to publish.
- **Importing from a URL** (optional). If you paste a link to import a
  reference, design system, or site, Design Factory fetches **that URL
  you provided** — nothing else.

That's the complete list. There is no other outbound traffic.

## If telemetry is ever added

We do not plan to add telemetry. If we ever do, it will be:

- **Opt-in only** — off by default. We will never use opt-out.
- **Disclosed** — clearly documented here before it ships.
- **Redacted at the source** — no prompt content, no project content, no
  keys; aggregate signal only, redacted on your machine before anything
  leaves it.

## Questions

Privacy questions can go through the same private channel as security
reports — see [SECURITY.md](SECURITY.md).
