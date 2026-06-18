<p align="right">
  <a href="README.md"><img alt="Português" src="https://img.shields.io/badge/lang-Portugu%C3%AAs-green.svg"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue.svg"></a>
</p>

<p align="center">
  <img src="docs/readme/assets/df-cover.png" alt="Design Factory" width="100%">
</p>

# Design Factory

O primeiro projeto open-source da HYVE.

<p>
  <a href="LICENSE"><img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache_2.0-blue.svg"></a>
  <a href="package.json"><img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933.svg"></a>
  <a href="docs/providers.md"><img alt="Multi-provider" src="https://img.shields.io/badge/providers-multi--model-ff5524.svg"></a>
</p>

Um experimento aberto que oferece um workspace local para tornar contexto,
direção e taste mais operáveis dentro do design assistido por IA. Uma
alternativa open-source ao Claude Design e outras aplicações fechadas de design
assistido por IA.

<p align="center">
  <img src="docs/readme/assets/hero.png" alt="Design Factory em ação — chat com direção à esquerda, artefato gerado à direita" width="100%">
</p>

---

## O que já entra nessa versão

| Área                                                 | Estado       |
| ---------------------------------------------------- | ------------ |
| Configuração de formatos, regras, comandos e prompts | estável      |
| Geração de artefatos HTML editáveis                  | estável      |
| Ingestão e preview de design systems                 | estável      |
| Criação e importação de skills                       | estável      |
| Tweaks por CSS variables                             | estável      |
| Edição de texto inline e propriedades de componentes | estável      |
| Comentários como direção estruturada                 | estável      |
| Snapshots de versão e file manager                   | estável      |
| Documentação pública                                 | estável      |
| Terminal integrado                                   | experimental |

---

## Providers

Você pode usar qualquer combinação dentro do mesmo projeto. Tokens vivem em
`~/.config/design-factory/` ou no seu ambiente — o navegador nunca toca os
secrets; o daemon controla a execução. Fonte canônica:
[docs/providers.md](docs/providers.md).

| Classe       | Providers                                      | Notas                              |
| ------------ | ---------------------------------------------- | ---------------------------------- |
| CLI agents   | Claude Code · Codex · Gemini · Opencode · Kimi | o daemon local spawna a CLI logada |
| APIs BYOK    | Anthropic · OpenAI · Gemini · OpenRouter       | chaves ficam locais                |
| Server local | Ollama                                         | offline                            |

---

## Começar

Antes de tudo, instale o **Node.js** (versão 20 ou mais nova) — o motor que roda
o app. Baixe em [nodejs.org](https://nodejs.org/) e clique no botão grande **LTS**.
Instale abrindo o arquivo e clicando avançar até o fim.

Você também precisa de pelo menos uma CLI de IA (como o Claude Code) ou uma chave
de API — é o que gera os designs.

Com o Node instalado, abra o Terminal e rode:

```bash
npm create design-factory
```

O comando baixa o projeto, instala dependências e sobe o app em
`http://localhost:1420`. Se a porta estiver ocupada, ele escolhe outra e mostra a URL.

<details>
<summary>Plano B (instalação manual)</summary>

Se `npm create design-factory` falhar, instale também o
[Git](https://git-scm.com/downloads) e rode:

```bash
git clone https://github.com/the-hyve-company/design-factory-app.git
cd design-factory-app
npm install
npm run dev:web
```

</details>

### No dia a dia (depois de instalado)

**Abrir o Design Factory:**

```bash
npm run dev:web
```

**Atualizar para a versão mais nova:**

```bash
git fetch origin && git reset --hard origin/main && npm install
```

Depois de abrir, vá em Configurações → Providers. As CLIs que você já tem
logadas aparecem conectadas; chaves BYOK entram só se você quiser. Crie um
projeto, dê contexto, gere, e refine com tweaks, comentários e edits. Passo a
passo em [docs/quickstart.md](docs/quickstart.md).

---

## Arquitetura

App React (UI, fluxo, preview, settings) mais daemon Node (filesystem, execução
de provider, streams SSE, terminal). Stack: React 18, Vite, TypeScript, Zod,
Node 20 HTTP/SSE, Vitest.

```txt
src/          App React
apps/daemon/  Ponte Node local
docs/         Documentação
skills/       Blocos de instrução reusáveis
projects/     Trabalho local (gitignored)
```

---

## Comandos

```bash
npm run dev:web     # app + daemon (abre o navegador)
npm run build       # TypeScript + Vite
npm test            # Vitest
```

Antes de um PR: `npx tsc --noEmit && npm test && npm run build`.

---

## Contribuir

O método precisa ser inspecionável e forkável. Comece por
[CONTRIBUTING.md](CONTRIBUTING.md) e [docs/providers.md](docs/providers.md).
Áreas abertas: adapters de provider, ingestão de design system, edição de
artefato, quality gates visuais, docs e testes.

---

## Licença

[Apache License 2.0](LICENSE) © The HYVE Company. Use, forke, estude e adapte.
Leia [NOTICE](NOTICE) antes de reusar as marcas HYVE ou Design Factory: a
licença cobre código e docs, a marca fica reservada.
