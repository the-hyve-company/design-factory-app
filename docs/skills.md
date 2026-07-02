# Skills

Skills are reusable instruction blocks that can be inserted into a
prompt with `/` commands. They are provider-agnostic: the app reads the
skill registry, inserts the selected instruction text, and sends the
compiled prompt to the active provider.

## Registry

The canonical registry lives at:

```text
skills/{slug}/SKILL.md
```

## Bundled skills

DF ships a curated set of third-party skills (6 today — the live list
with triggers and licenses is auto-generated in
[catalog.md](catalog.md)). Each bundled skill folder carries its
upstream LICENSE and/or a provenance `NOTICE.md`; the root
[NOTICE](../NOTICE) file indexes all of them, and CI keeps that index
in sync with the disk. A bundled skill that requires an output channel
no provider offers (e.g. image generation) stays installed but is not
offered in the slash menu — see `requires:` below.

Each `SKILL.md` can include frontmatter such as name, description, and
trigger metadata, followed by the instruction body. The instruction body
should be clear, scoped, and written for the model that will apply it —
agent-neutral (it is sent to every provider, so never address one model
by name). An optional `requires:` list declares output channels the
skill depends on (e.g. `requires: ["image-generation"]`); skills that
require a channel no DF provider supports are kept out of the slash
menu by the capability gate.

The app can also read legacy `.claude/skills/` folders for import and
migration, but new skills created or imported through the app land in
`skills/`.

## Using a skill

In the chat box, type `/` to open the skills menu. Pick a skill, then
send the prompt or keep typing to add arguments. Inserting a skill does
not send the prompt automatically.

Skills work best when they describe a repeatable behavior: interface
review, motion polish, slide structure, accessibility pass, or a
specific product writing style.

## Importing a skill

The import flow accepts:

- a Markdown file;
- a zip bundle containing a skill file;
- a raw URL such as a GitHub raw file or Gist;
- a local skills folder.

Every import path shows a preview before install. Read imported skills
before enabling them. A skill becomes prompt context for the provider,
so it should not contain secrets or instructions you would not want sent
with a generation request.
