# Design Factory Docs

Use this page as the public documentation entry point. The docs are
plain Markdown and work directly on GitHub or GitHub Pages.

## Start here

| Doc                                   | Use it for                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| [Quickstart](quickstart.md)           | Install, run locally, connect a provider, and create the first project. |
| [Providers](providers.md)             | See which CLIs, API providers, and local models Design Factory can use. |
| [Troubleshooting](troubleshooting.md) | Fix common provider, daemon, Ollama, and file write issues.             |

## Concepts and internals

| Doc                                 | Use it for                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)     | A conceptual map of how the daemon, runtime, and providers are wired.                 |
| [Design systems](design-systems.md) | Give the model project-specific brand and component direction before it writes files. |
| [Project files](project-files.md)   | How generated work is stored as regular files under `projects/`.                      |
| [Skills](skills.md)                 | Reusable `/` instruction blocks, provider-agnostic, shared across every provider.     |

## Agent support

| Doc                                 | Use it for                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- |
| [Agent contract](agent-contract.md) | Rules used by repository agent files such as `AGENTS.md` and `GEMINI.md`. |

## Docs hosting

The public docs do not need a separate docs service. In a public GitHub
repository, enable GitHub Pages and serve either the repository root or
the `/docs` folder. This `index.md` page becomes the docs landing page
for the `/docs` option.
