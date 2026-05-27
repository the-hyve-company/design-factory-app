<p align="right">
  <a href="README.md"><img alt="Português" src="https://img.shields.io/badge/lang-Portugu%C3%AAs-green.svg"></a>
  <a href="README.en.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue.svg"></a>
</p>

<p align="center">
  <img src="docs/readme/assets/df-cover.png" alt="Design Factory" width="100%">
</p>

# Design Factory

**Crie e manipule design com IA sem começar de um prompt vazio.**

<p>
  <a href="LICENSE"><img alt="Licença: Apache 2.0" src="https://img.shields.io/badge/license-Apache_2.0-blue.svg"></a>
  <a href="package.json"><img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933.svg"></a>
  <a href=".github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/the-hyve-company/design-factory/ci.yml?branch=main"></a>
  <a href="docs/providers.md"><img alt="Multi-provider" src="https://img.shields.io/badge/providers-multi--model-ff5524.svg"></a>
</p>

Design Factory é um workspace local-first e open-source para gerar,
editar e organizar artefatos HTML com IA. Cada projeto começa com
direção: canvas, formato, regras, design system, skills e comandos
antes do primeiro output.

Você escolhe o modelo para cada etapa, sem trocar de projeto: CLI
agents, APIs BYOK ou modelos locais. O resultado continua no seu
ambiente: arquivos, versões, prompts, comentários e ajustes ficam
acessíveis, editáveis e inspecionáveis.

<p>
  <a href="#começar"><img alt="Começar" src="https://img.shields.io/badge/▶_Começar-1d2128?style=for-the-badge"></a>
  <a href="docs/README.md"><img alt="Docs" src="https://img.shields.io/badge/Docs-1d2128?style=for-the-badge"></a>
  <a href="docs/providers.md"><img alt="Providers" src="https://img.shields.io/badge/Providers-1d2128?style=for-the-badge"></a>
  <a href="CONTRIBUTING.md"><img alt="Contribuir" src="https://img.shields.io/badge/Contribuir-1d2128?style=for-the-badge"></a>
  <a href="https://github.com/the-hyve-company/design-factory/discussions"><img alt="Discussão" src="https://img.shields.io/badge/Discussão-1d2128?style=for-the-badge"></a>
</p>

---

## O que isso resolve

A maioria dos fluxos de design com IA começa em uma caixa de prompt
vazia.

Você descreve o que quer, recebe um output, tenta corrigir no próximo
pedido e, aos poucos, perde contexto, intenção visual, versões boas e
controle sobre o arquivo final.

Design Factory organiza esse loop em um projeto local.

Antes de gerar, você define a direção.
Durante a geração, você escolhe o modelo.
Depois do output, você edita, comenta, ajusta, preserva versões e
continua trabalhando sobre arquivos reais.

---

## Como funciona

Design Factory trabalha em três momentos.

### 1. Comece com direção

Um projeto pode nascer com:

- canvas e proporção;
- tipo de artefato;
- objetivo;
- design system;
- referências;
- restrições visuais;
- regras de qualidade;
- skills e comandos reutilizáveis.

Em vez de pedir "algo moderno", você declara o que moderno significa
naquele projeto.

### 2. Escolha o modelo certo para a etapa

O provider não é o centro do produto.

Você pode usar Claude Code, Codex CLI, Gemini CLI, Opencode, Kimi, APIs
BYOK ou modelos locais. O contexto permanece no projeto. O modelo vira
uma rota de execução.

### 3. Refine sem começar de novo

O primeiro output não precisa ser descartado.

Você ajusta variáveis visuais, edita texto inline, comenta partes do
resultado, preserva snapshots, compara versões e continua refinando o
arquivo local.

O fluxo é simples:

**contexto → geração → edição → versão local**

---

## O que entra neste preview público

Design Factory está no começo. Algumas superfícies são estáveis, outras
ainda experimentais, e o projeto está sendo aberto para o método poder
ser testado em público.

| Área | Status | O que faz |
| --- | --- | --- |
| Arquivos de projeto | Disponível | Projetos são pastas em `projects/` |
| Geração de artefato HTML | Disponível | Gera outputs HTML editáveis a partir de prompts |
| Picker multi-provider | Disponível | Usa CLI agents, BYOK APIs ou providers locais |
| Design systems | Disponível | Anexa regras e referências de design a projetos |
| Tweaks | Disponível | Expõe CSS variables como sliders para ajustar sem outra chamada de LLM |
| Edit de texto inline | Disponível | Edita texto na preview e grava as mudanças no disco |
| Loop de comentários / direção | Disponível | Usa feedback como direção estruturada para o próximo turn |
| Snapshots de versão | Disponível | Salva e restaura estados manuais do projeto |
| File manager | Disponível | Inspeciona e gerencia arquivos do projeto |
| Terminal embarcado | Experimental | Útil para comandos do projeto; não é necessário para o loop principal |
| Setup de providers | Disponível | Detecta CLIs instaladas e salva chaves BYOK só quando você escolhe um provider de API |
| Docs públicas | Disponível | Quickstart, providers, arquitetura, smoke runbook, troubleshooting e docs de contribuição |

---

## Começar

Tem duas formas de rodar. Escolha pelo quanto de acabamento você quer hoje.

### ✅ Local (estável — recomendado)

É o caminho testado — o que usamos todo dia. Precisa de **Node 20+** e pelo
menos um provider disponível.

```bash
git clone https://github.com/the-hyve-company/design-factory.git
cd design-factory
npm install
npm run dev:web
```

Abra a URL que o launcher mostrar em **▸ Abra:** (normalmente):

```txt
http://localhost:1420
```

Se a 1420 estiver ocupada, o launcher escolhe outra porta automaticamente e
mostra a URL certa no banner — basta abrir a que ele indicar. O daemon local
roda em `http://localhost:1421`.

### 🧪 App desktop (experimental — mais fácil, sem terminal)

Um app de duplo-clique, com ícone na barra de tarefas. Sem terminal, sem
`npm`. **É novo e ainda instável** — espere bugs que estamos corrigindo.

Baixe para o seu sistema na
[página de Releases](https://github.com/the-hyve-company/design-factory/releases/latest):

- **Windows:** `Design.Factory_<versão>_x64-setup.exe`
- **macOS (Apple Silicon):** `Design.Factory_<versão>_aarch64.dmg`

> ⚠️ **O app ainda não é assinado digitalmente**, então o seu sistema ou o seu
> antivírus vai avisar — e pode até bloquear a instalação. Isso é esperado em
> software open-source não-assinado: o motor embutido é um binário recém-compilado,
> sem reputação ainda. O projeto é open-source — você lê cada linha. A assinatura
> digital, que remove esses avisos de vez, está no nosso roadmap.

**Windows (SmartScreen):** "O Windows protegeu o seu computador" →
*Mais informações* → *Executar assim mesmo*.

**Windows (antivírus — Kaspersky, Defender, etc.):** alguns antivírus **apagam o
motor do app durante a instalação** (você vê uma pasta vazia ou um erro de "motor
não encontrado"). Pause a proteção do antivírus durante a instalação **ou** adicione
uma exclusão para a pasta de instalação (`…\AppData\Local\Programs\Design Factory`)
e para a pasta temporária (`…\AppData\Local\Temp`), e reinstale.

**macOS (Gatekeeper):** clique com o botão direito no app → *Abrir* → *Abrir*.
Ou Ajustes → Privacidade e Segurança → *Abrir Assim Mesmo*.

Se isso parecer fricção demais, use o caminho **Local (estável)** acima — lá não
tem nenhum aviso.

### Depois de abrir (qualquer caminho)

- abra **Configurações → Providers**;
- se você já tem uma CLI suportada instalada e logada, o Design Factory
  detecta e marca o card como conectado;
- adicione uma chave de API só se quiser usar um provider BYOK;
- crie um projeto;
- adicione contexto, regras ou um design system;
- gere um artefato HTML;
- refine com tweaks, comentários e edits.

Walkthrough completo em [docs/quickstart.md](docs/quickstart.md).

---

## Providers

Design Factory é provider-agnostic por arquitetura. O app trabalha com
classes diferentes de modelos:

| Classe | Exemplos | Notas |
| --- | --- | --- |
| CLI agents | Claude Code, Codex CLI, Gemini CLI, Opencode CLI, Kimi Code CLI | Spawnados pelo daemon local |
| APIs BYOK | Anthropic, OpenAI, Gemini, OpenRouter | As chaves ficam locais |
| Servers locais | Ollama | Útil para experimentos offline |

Disponibilidade e maturidade de cada provider mudam rápido. A fonte
canônica é [docs/providers.md](docs/providers.md).

---

## Onde os tokens moram

Tokens de providers pagos são lidos localmente, de variáveis de
ambiente ou de arquivos de config em:

```txt
~/.config/design-factory/
```

O browser não acessa os secrets do provider direto. O daemon controla a
execução.

---

## Arquivos e providers

Design Factory é software open-source que você roda a partir do repo. O
ponto operacional não é ele ser "local"; é o trabalho continuar
inspecionável:

- projetos são pastas em `projects/`;
- outputs gerados são HTML/assets que você abre ou commita;
- providers CLI são descobertos a partir do setup do seu terminal;
- chaves de API são opcionais e só entram para providers BYOK;
- a execução de provider passa pelo daemon em `localhost`.

O workflow fica simples: use o modelo a que você já tem acesso, gere um
arquivo, inspecione, ajuste e continue iterando.

---

## Arquitetura

Design Factory tem duas partes principais.

| Camada | Papel |
| --- | --- |
| App React | UI, fluxo de projeto, preview, settings, direção de design, picker de provider |
| Daemon Node | Fronteira de filesystem, execução de provider, streams SSE, ponte de terminal local |

### Stack principal

| Camada | Escolha |
| --- | --- |
| UI | React 18 + Vite + TypeScript |
| Routing | React Router |
| Validação | Zod |
| Markdown | marked + highlight.js + DOMPurify |
| Terminal | xterm.js |
| Daemon | Node 20 HTTP + SSE |
| Testes | Vitest + Playwright |

### Forma do repositório

```txt
design-factory/
├── src/              # App React
├── apps/daemon/      # Ponte Node local
├── docs/             # Documentação pública
├── skills/           # Blocos de instrução reusáveis e comandos
├── tests/            # Testes unit + visual
└── projects/         # Trabalho local do usuário, gitignored
```

Para setup de contribuição e detalhes de providers, comece por:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/providers.md](docs/providers.md)

---

## Comandos

```bash
npm run dev          # Só Vite (:1420)
npm run bridge       # Só daemon (:1421)
npm run dev:web      # App + daemon

npm run build        # Build TypeScript + Vite
npm run preview      # Serve o build de produção

npm test             # Vitest
npm run test:watch   # Vitest watch
npm run test:ui      # Vitest UI
npm run test:visual  # Playwright visual regression
npm run i18n:audit   # Audita cobertura PT-BR ↔ EN
```

Gates recomendados antes de abrir PR:

```bash
npx tsc --noEmit
npm test
npm run build
```

---

## Design systems

Design Factory anexa contexto de design a um projeto para todo turn
começar com restrições melhores.

Um design system pode incluir:

- paleta;
- tipografia;
- grid;
- spacing;
- materialidade;
- regras de motion;
- regras de interação;
- anti-patterns;
- exemplos e contra-exemplos.

A ideia é parar de pedir ao modelo qualidades vagas como "moderno",
"premium" ou "limpo", e passar a declarar o que essas palavras
significam dentro do projeto.

---

## Tweaks, comentários e edits

O loop pós-geração faz parte do produto, não é feature secundária.

### Tweaks

Quando um artefato expõe CSS variables, Design Factory pode bindá-las a
sliders. Você ajusta parâmetros visuais sem gastar outra chamada de
modelo. Por exemplo:

- spacing;
- radius;
- contrast;
- density;
- intensidade de motion;
- profundidade de surface;
- escala tipográfica.

### Comentários

Comentários viram direção. Em vez de reescrever o prompt inteiro, você
aponta o que precisa mudar e mantém o contexto do projeto intacto.

### Edits

Edits inline resolvem mudanças pequenas direto. Nem tudo precisa de
outra geração.

É aqui que direção artística vira prática: ajusta o que importa,
preserva o que funciona e mantém o loop andando.

---

## Taste não é um preset

Design Factory não tenta automatizar julgamento visual.

Taste aparece nas escolhas que entram antes da geração e nas decisões
tomadas depois dela: referências, restrições, design systems,
anti-patterns, comentários, edits e versões preservadas.

O modelo gera. O projeto guarda contexto. Quem dirige é você.

---

## O que isso não é

Design Factory não é um substituto de Figma, um construtor de site
hospedado, um wrapper genérico de chatbot, uma plataforma de design na
nuvem, um marketplace de prompts nem um botão "torna premium". Também
não promete automatizar taste.

É um experimento: dar a taste, contexto e direção uma interface melhor
dentro do design assistido por IA.

---

## Contribuir

Design Factory é open-source porque o método precisa ser inspecionável,
forkável e melhorável.

Contribuições são bem-vindas em torno de:

- adapters de provider;
- workflows de provider;
- ingestão de design system;
- edição de artefato;
- quality gates visuais;
- documentação;
- exemplos;
- testes.

Comece por:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/providers.md](docs/providers.md)

Antes de adicionar uma feature nova, pergunte:

- Melhora a direção?
- Torna o output mais editável?
- Mantém a escolha de provider aberta?
- Reduz resultado genérico?

Se a resposta é não, provavelmente não pertence ao core.

---

## Comunidade

- **Discussões:** use o GitHub Discussions para perguntas, experimentos
  e ideias.
- **Issues:** use o GitHub Issues para bugs reproduzíveis e pedidos de
  feature com escopo definido.

---

## Licença

[Apache License 2.0](LICENSE) © The HYVE Company.

Use, forke, estude e adapte sob os termos da
[Licença Apache 2.0](LICENSE). Atribuição é bem-vinda, não obrigatória.
Leia o arquivo [NOTICE](NOTICE) antes de reusar as marcas HYVE ou
Design Factory: a licença cobre código e docs, a marca fica reservada.

---
