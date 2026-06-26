# Design Factory — Elevação de Craft: plano consolidado

> Documento mestre. Reúne: decisão de arquitetura + catálogo de genéricos ("cara de IA") +
> research de fontes de craft + gap-analysis + plano de implementação.
> Worktree: `chore/df-prompt-craft-revision`. Status: **design fechado, aguardando ok pra implementar.**

---

## 0. Sumário executivo

**Problema:** a geração do DF sai com craft baixo — genérica ("cara de IA"), ignorando regras,
qualidade técnica fraca, longe do nível do agente Designer do HYVE.

**Por que não dá pra copiar o Designer:** (1) o DF é **multi-provider** (10 providers) — os
hooks do Designer são Claude-Code-only; (2) **valores de design não pertencem ao system prompt**
— pertencem às rules (editáveis, versionáveis).

**Decisão:** separar responsabilidades em camadas, pôr o craft nas **rules**, manter um **piso
sempre-on** (contexto estático + core rules) e substituir os hooks por uma **validação
determinística pós-geração** (`static-p0`) que sinaliza + oferece auto-fix — agnóstica de provider.

**Números:** o DF já cobre ~40/50 rules conceitualmente. O trabalho: enriquecer 11 rules com
valores, criar ~15 rules novas (tells de 2026), implementar 30 checks determinísticos, marcar
10 core. Mais a limpeza dos design systems embarcados (já feita: pasta esvaziada).

---

## 1. Contexto

Testes de geração saíram com craft baixo. Em paralelo, decidiu-se **esvaziar os design systems**
embarcados (eram 11 de marcas de terceiros — risco de IP num OSS público; já removidos na
worktree). Isso agrava o problema: sem DS carregado e com rules opt-in, **nada segura o craft
por padrão** — daí a necessidade de um piso sempre-on.

---

## 2. Decisões resolvidas

| # | decisão | razão | descartado |
|---|---|---|---|
| 1 | **Separação por camada** — prompt=comportamento, rules=craft, DS=tokens | cada coisa no seu lar, craft editável | craft no system prompt (acopla, não-editável) |
| 2 | **Piso sempre-on = contexto estático + core rules** | com DS vazio e rules opt-in precisa de default agnóstico | só um dos dois (incompleto) |
| 3 | **Substituto dos hooks = validação determinística (`static-p0`)** | roda no daemon após qualquer provider — agnóstico por construção | hooks por-provider (impossível em 10) |
| 4 | **Rede determinística: sinaliza + auto-fix opcional** | não queima tokens, respeita variação por provider, dá controle | só sinalizar (usuário casual sem conserto); auto-corrigir sempre (caro, varia) |
| 5 | **Design systems embarcados: esvaziar** | OSS público, risco de IP; founder cria o DS do DF depois | manter marcas de terceiros |
| 6 | **Rules "core" = default de fábrica editável, não hardcoded** (refina #2) | founder: vem com default habilitado → edito meu padrão em config → override por projeto. Controle real do usuário, 3 níveis (fábrica → meu default → projeto) | core travado no prompt (não-editável, não é "minhas regras") |

**Sobre a #6 e o piso:** ao tornar as rules de gosto 100% editáveis, o "piso de não-vergonha"
sai do prompt e vive **só** no `static-p0` (rede pós-geração, decisão #3/#4). Assim desligar todas
as rules no config **não** reintroduz slop óbvio — o anti-slop P0 (indigo/emoji/preto-puro/contraste)
roda sempre, separado da seleção do usuário. Persistência: setting `default_rule_ids` (factory =
os 14 `core: true`), mesmo padrão dos canvas presets (`getSetting`/`setSetting`).

### Separação por camada

| Camada | Papel |
|---|---|
| System prompt | *comportamento* — como operar, formato de saída |
| Rules | *o craft* — do's/don'ts concretos |
| Design system | *os tokens* — cores, fontes, spacing reais |
| Dials | *calibração* — densidade, motion, contraste |
| Format | *tipo de artefato* — landing, dashboard |

---

## 3. Arquitetura de enforcement

```
A CADA PROMPT, todo provider:
  • System prompt magro ............ só comportamento (sem valores)
  • Contexto estático (agent-contract) ... output contract + DON'TS (tells de IA)   [já existe]
  • Rules default (factory=core) ... pré-preenchem o picker, editáveis em config + por projeto
  • Design system inlined .......... quando houver tokens
  • Direção do projeto ............. format + dials + rules (default + override do projeto)    [já existe]

DEPOIS de gerar (rede determinística, agnóstica de provider):
  • static-p0 expandido ............ sintaxe (hoje) + 30 checks de craft (novo)
                                     falha dura: re-tenta · slop: sinaliza + auto-fix (/polish)

SOB DEMANDA:
  • Commands/skills (/polish, /critique) ... passadas extras (espelhar P0/P1/P2 do open-design)
```

**Substituto dos hooks (a peça-chave):** o Designer HYVE bloqueia *fora do modelo* via hooks do
Claude Code. O DF faz o mesmo *fora do modelo* via `static-p0` no daemon — centralizado no
produto, não no harness. Mesma ideia, lugar diferente. É o único ponto que roda igual pros 10
providers.

### Mudanças concretas (arquivos)

- **`src/runtime/prompt-invoker.ts:214` — `GENERATE_CORE_SYSTEM` emagrece.** Sai o bloco
  "Discipline" (palette/type/space/shape/depth = valores) → vira rules. Fica comportamento:
  HTML completo auto-contido, código no arquivo / status no chat, copy real, single Write,
  "siga as rules e o DS abaixo".
- **`docs/agent-contract.md §6` — vira o catálogo de don'ts.** Já inlined em
  CLAUDE.md/GEMINI.md/AGENTS.md pra todo provider. Carrega os ~14 tells universais (1 linha cada).
- **`src/data/rules-taxonomy.ts` — tipo `Rule` ganha `tier`/`core`/`checkable` + porta a biblioteca
  (132 rules). `core: true` = membros da default de fábrica.**
- **Settings `default_rule_ids`** — factory = ids `core`. `getSetting`/`setSetting` (padrão canvas
  presets). Editável num painel de config (espelha `CanvasPresetsEditor`).
- **`NewProjectFormSkeu.tsx:444` — picker inicia da default** (`useState([])` → lê `default_rule_ids`),
  não vazio. Modal continua fazendo override por projeto.
- **`src/runtime/canonical-plus-prompt.ts` — injeta as rules do projeto** (default herdada + override).
- **`src/runtime/static-p0.ts` — 30 checks grep-able** + status `craft-warn` + UI auto-fix =
  o piso anti-slop real (independe da seleção de rules).

---

## 4. Catálogo de genéricos — "cara de IA" (jun/2026)

Fontes: jakub.kr · vibecoded-design-tells (dataset Reddit-mined ~47k posts) · aifire 2026.
Status DF: ✓ existe · ⚠ parcial · ✗ falta.

### 4.1 Tells por frequência empírica

| # | tell | DF | ação |
|---|---|---|---|
| 1 | **shadcn/Tailwind default look** (o maior tell de 2026) | ✗ | `as-no-shadcn-default` |
| 2 | AI-purple gradient | ✓ `as-no-generic-ai-gradient` | core/enriquecer |
| 3 | Gradient hero text (`background-clip:text`) | ✗ | `as-no-gradient-text` |
| 4 | Neon glow não-pedido | ⚠ `as-no-invented-decoration` | enriquecer + check |
| 5 | Emoji como ícone | ✓ `as-no-decorative-emojis` | core |
| 6 | Centered hero + 3 cards | ⚠ `ly-dont-center-everything` | `ly-no-hero-three-card` |
| 7 | Bento grid uniforme | ✗ | `ly-no-uniform-bento` |
| 8 | Glassmorphism default | ✓ `as-no-default-glassmorphism` | — |
| 9 | Aurora/mesh/blob background | ✗ | `as-no-aurora-bg` |
| 10 | "Tasteful default" (cream+serif+sage) | ✗ | `as-no-tasteful-default` |

### 4.2 Tells adicionais

Dot-grid/pattern bg (`as-no-decorative-bg-pattern`) · fade-up universal no scroll (reforçar
`mo-restrained-entrances`) · fonte default Inter/system (reforçar `ty-one-or-two-typefaces`) ·
copy genérica "We help teams collaborate" (`cp-no-generic-copy`) · fake metrics "10x faster"
(`cp-no-fake-metrics`) · logo cloud cinza "Trusted by" (`ly-no-fake-logo-cloud`).

### 4.3 Do's de craft (Jakub) — positivos

text-wrap `balance`/`pretty` (`ty-text-wrap`) · `-webkit-font-smoothing:antialiased` ·
radius concêntrico (outer = inner + padding) · tabular-nums (✓) · sombra multicamada > borda
(`de-shadow-over-border`) · image outline `1px rgba(0,0,0,.1) offset -1px` (`im-subtle-outline`) ·
optical alignment (✓) · transições interrompíveis · stagger 100ms · exit < enter.

### 4.4 Cor (Jakub OKLCH/gradients)

OKLCH perceptual; lightness constante variando hue (sem drift); chroma controlado; OKLAB pra
gradiente; color hints; blend modes pra textura.

### 4.5 Motion & gesture

**Núcleo transferível (CSS/vanilla → vira rule):** só compositor (transform/opacity/filter/
clip-path), nunca layout · will-change com parcimônia · curva assimétrica/spring · transições
interrompíveis · stagger · exit<enter · reveal seletivo no scroll (não fade-up universal) ·
focus sutil · reduced-motion.
**Gesture (opt-in, raro em one-shot):** tap scale 0.95–0.8, drag momentum-off + elastic 0.05 +
snap a pontos.
**Avançado (só export React):** shared-layout/FLIP.

---

## 5. Research: fontes de craft (2026)

20 fontes × 4 dimensões. Marcadores: **[GREP]** detectável · **[INSTR]** só instrução ·
**[STATIC]** transfere pro one-shot · **[FW]** precisa framework.

### 5.1 Descobertas-chave

1. **Convergência clássica = canon de fato:** linha 45–75ch · line-height ~1.5 · weight ≥400 ·
   escala de espaço 8-based · near-black/white · ease-out default · só transform/opacity · ≤300ms.
2. **Fontes 2026 estendem** pra banlists de tells de LLM, valores de motion, OKLCH, DS-para-agentes.
3. **Já existem "linters anti-slop"** — espelhar, não reinventar: `open-design.ai/craft/anti-ai-slop`
   (P0/P1/P2 + hex Tailwind banidos), `vercel-labs/open-agents → web-animation-design`,
   **`interfaces.rauno.me`** (Web Interface Guidelines).
4. **Spring nativo em CSS via `linear()`** (Comeau) — motion premium no HTML estático **sem
   framework**, ~1.3kB. Mata a limitação "o DF não roda React".
5. **OKLCH + escala de 12 papéis (Radix)** = contrato de cor: cada decisão tem um passo certo.

### 5.2 Mapa de fontes

| fonte | url | dimensão |
|---|---|---|
| Anthony Hobday — Safe rules | anthonyhobday.com/sideprojects/saferules/ | taste (espinha dorsal) |
| Refactoring UI | refactoringui.com | taste/cor/type |
| Erik Kennedy — 7 rules | learnui.design/blog | taste |
| open-design — anti-ai-slop | open-design.ai/craft/anti-ai-slop | anti-slop (linter pronto) |
| Elkholy — Anti-Slop Framework | moelkholy1995.medium.com | anti-slop/motion |
| Rauno — Invisible Details / Novelty | rauno.me/craft | micro-craft |
| Rauno — Web Interface Guidelines | interfaces.rauno.me | micro-craft/motion |
| Devouring Details | devouringdetails.com | micro-craft |
| Emil Kowalski | emilkowal.ski/ui/* | motion |
| Josh Comeau | joshwcomeau.com/animation/* | motion (spring via linear()) |
| Cassie Evans / GSAP | gsap.com/docs/v3/Eases | motion |
| web.dev / Adam Argyle | web.dev/articles/animations-guide | motion |
| Material Design 3 — motion tokens | m3.material.io/styles/motion | motion (régua exata) |
| Matthew Ström | matthewstrom.com/writing/how-to-pick-the-least-wrong-colors | cor |
| Evil Martians — OKLCH (+ DS for agents) | evilmartians.com/chronicles | cor |
| Radix Colors | radix-ui.com/colors/docs | cor (12 papéis) |
| Butterick — Practical Typography | practicaltypography.com/summary-of-key-rules | type |
| jakub.kr (9 artigos) | jakub.kr | craft/motion/cor (ref primária) |

### 5.3 Régua numérica — 30 checks candidatos (grep-able, static)

| # | check | valor | fonte |
|---|---|---|---|
| 1 | banir `#000`/`#fff` puros | exato | Hobday, Elkholy |
| 2 | banir indigos Tailwind | 7 hex | open-design |
| 3 | cor em OKLCH (banir hex/rgb/hsl em cor) | — | Evil Martians |
| 4 | cinza C=0 · acento C≤0.20 · fill grande C baixo | OKLCH | Evil Martians |
| 5 | banir emoji-ícone em h*/button/li | glyph list | open-design |
| 6 | banir fontes default (Inter/Roboto/Arial/Times/Open Sans/Montserrat) | banlist | Butterick, Kennedy, Elkholy |
| 7 | body font-size 15–25px (≥16) | px | Hobday, Butterick |
| 8 | linha 45–75ch (~66ch) | ch | Hobday, RefUI, Butterick |
| 9 | line-height corpo 1.2–1.5 | ratio | Butterick, RefUI |
| 10 | font-size só na escala (12/14/16/18/20/24/30/36/48/64) | escala | RefUI |
| 11 | spacing só na escala (4/8/12/16/24/32/48/64) | escala | Hobday, RefUI |
| 12 | weight ≥400 | — | RefUI |
| 13 | underline só em `<a>` | — | Butterick |
| 14 | sem bold+itálico no mesmo seletor | — | Butterick |
| 15 | banir em-dash (—) e `--`/`...` | exato | Butterick, Elkholy |
| 16 | animar só transform/opacity (nada de layout props) | exato | Emil, web.dev |
| 17 | banir `transition: all` | exato | Elkholy |
| 18 | duração de UI 100–300ms | faixa | Emil, MD3 |
| 19 | `linear` só em loop | — | Emil, GSAP |
| 20 | entrada ease-out / saída accelerate; exit ≤ enter | — | Emil, MD3, GSAP |
| 21 | press scale 0.90–0.97 (nunca 0.8) | faixa | Rauno, Emil |
| 22 | dialog não anima de scale(0) | — | Rauno, Emil |
| 23 | `@media (prefers-reduced-motion)` presente se há animação | — | Emil |
| 24 | hover sob `@media (hover:hover)` | — | Emil |
| 25 | `will-change: all` proibido | exato | web.dev, Jakub |
| 26 | sem mudança de font-size/weight/case no `:hover` | — | Kennedy |
| 27 | botão padding H = 2× V | ratio 2:1 | Hobday |
| 28 | shadow blur = 2× offset · sem shadow em dark | — | Hobday |
| 29 | brightness containers aninhados ≤12% dark / ≤7% light | HSB | Hobday |
| 30 | contraste APCA Lc≥60 corpo (≈WCAG 4.5:1) · 3:1 não-texto | — | Radix, Ström, Elkholy |

### 5.4 Só INSTR (guia o prompt, não vira check)

grayscale-first · emphasize-by-de-emphasizing · up/down-pop · alinhamento óptico · regra 90/10 de
novidade · robustness/edge-cases · "uma resposta óbvia por caso de uso" · ~80% provado + 20%
distintivo · não-repetição de layout / sem fake dashboard.

### 5.5 Não transfere pro one-shot (só export React)

drag-to-dismiss com velocity · peek/snap · pinch · skip-delay de tooltip · command palette ·
shared-layout/FLIP · spring config "real" · pause-on-offscreen.

### 5.6 Benchmark competitivo + correções factuais

**Decisão (founder):** construir o craft do DF **do nosso jeito**, a partir da research acima —
NÃO adaptar o `craft/` do concorrente.

O **open-design** (Apache-2.0, v0.10.0) é o benchmark de validação: arquitetura quase idêntica
ao DF (daemon Express+SQLite, iframe sandbox, streaming `<artifact>`, BYOK proxy SSRF-guarded,
MCP, `DESIGN.md` 9-seções, **`lint-artifact` + critique pre-emit gate** = a nossa rede
determinística). Confirma 100% a direção. Tem 13 craft files (anti-ai-slop, color,
animation-discipline, accessibility-baseline, typography, typography-hierarchy, laws-of-ux,
state-coverage, form-validation, rtl-and-bidi). **Usamos como referência cruzada, não como fonte.**

**Correções factuais a aplicar (vêm de WCAG/Material/pesquisa primária — não do concorrente):**
- **Touch target:** AA = **24×24px** (WCAG 2.5.8); 44×44 é **AAA** (2.5.5). Ajustar
  `fo-generous-touch-targets`: 24 é o floor, 44 é craft.
- **Accent:** cap em **≤2 usos visíveis por tela** (refina `co-accent-sparingly`).
- **Dark:** bg `#0f0f0f` / fg `#f0f0f0` (não #000/#fff); borda dark = `rgba(255,255,255,0.08)`.
- **Motion:** default **150ms**, frequentes **≤200ms**, micro **<500ms**; M3 standard easing
  `cubic-bezier(0.2,0,0,1)` (não o M2 `0.4,0,0.2,1`); curve pra opacity/cor, spring pra
  position/scale/gesto.
- **Contraste:** WCAG 2.2 AA é o floor (4.5:1 corpo · 3:1 grande/não-texto); APCA (Lc≥60) é
  design-review, não compliance.

**Mitos a NÃO citar nas rules (desmascarados pela pesquisa):** "Doherty = 400ms" (paper não tem
400; menor medido = 300ms) · "skeleton 11% mais rápido" (mediu barra de progresso, não skeleton) ·
"44×44 = AA" (é AAA) · "ARIA sempre melhora a11y" (empiricamente o oposto — WebAIM 2026).

---

## 6. Plano de rules — biblioteca completa

**Decisão (founder):** **reescrever todas as 50** rules com valores concretos + expandir pra uma
**biblioteca de ~110-130 rules profundas**, cobrindo TODAS as dimensões (visual + a11y + copy +
i18n/RTL + laws-of-ux + 8-estados + motion fundamentado). Nível do benchmark, não base rasa.
**Não infla o prompt:** só **core (10-15)** + rules selecionadas entram por geração; o resto é
biblioteca opt-in; os valores grep-able viram checks no `static-p0`.

### Categorias (de ~50 rasas → ~131 profundas)

| categoria | hoje | alvo | foco do que falta |
|---|---|---|---|
| anti-slop | 5 | ~13 | tells 2026: shadcn-default, gradient-text, aurora, dot-grid, tasteful-default |
| typography | 7 | ~15 | escala c/ valores, text-wrap, font-smoothing, no-default-fonts, smart-quotes, hierarchy 3-eixos |
| color | 6 | ~14 | OKLCH, 4 camadas, accent≤2, chroma budget, dark tokens, 12 papéis, contrast |
| motion | 5 | ~14 | gpu-only, durações por tipo, curve/spring, will-change, no-transition-all, press-scale, clip-path, css-spring |
| layout | 7 | ~12 | escala spacing, 12-col, padding-ratio, hero-variation, no-bento-uniforme |
| depth | 4 | ~8 | shadow=2×offset, no-shadow-dark, concentric, shadow>border, image-outline |
| states | 5 | ~10 | os 8 estados, loading, optimistic, selected≠hover |
| forms | 4 | ~9 | validation wiring, erro acionável, redundant-entry, no-placeholder-label |
| imagery | 4 | ~6 | aspect, treatment, overlay (5 métodos), no-stock |
| icons | 3 | ~4 | stroke 1.6-1.8, currentColor, clarify-not-decorate |
| **a11y** (nova) | 0 | ~10 | contrast AA, focus, keyboard, aria-discipline, alt, lang, heading, landmarks, target-size 24/44 |
| **copy** (nova) | 0 | ~6 | no-generic, no-fake-metrics, no-em-dash, microcopy acionável, sentence-case |
| **i18n/RTL** (nova) | 0 | ~4 | rtl-bidi, logical properties, locale numbers |
| **laws-of-ux** (nova) | 0 | ~6 | Fitts, Hick, Miller, Jakob, proximity, aesthetic-usability |
| **TOTAL** | 50 | **~131** | |

### Schema de rule (estendido — muda o tipo `Rule`)

```
{ id, title, category,
  tier: "P0" | "P1" | "P2",   // severidade (P0 must-fix)
  core: boolean,               // sempre-on?
  checkable: boolean,          // tem check determinístico no static-p0?
  description }                // ✗ não faça (com valor) / ✓ faça no lugar
```

Sem `source` (founder: "nao acho q precisa a fonte nem explciar muito, maiss o q nao fazer e
o q fazer no lugar"). A proveniência fica na research (§5), não na rule. description enxuta:
2 linhas — `✗` o que evitar + `✓` o que fazer, com o valor concreto embutido.

### Core = default de fábrica (14, editável — decisão #6)

Não são "sempre-on travadas": são as rules que **vêm habilitadas por padrão** e pré-preenchem o
picker. O usuário edita o conjunto em config (`default_rule_ids`) e faz override por projeto. Os 14:
`as-no-generic-ai-gradient` · `as-no-decorative-emojis` · `ty-limited-type-scale` ·
`ty-weight-for-hierarchy` · `ty-comfortable-measure` · `co-few-colors-neutral-base` ·
`co-no-raw-black` · `ly-generous-spacing` · `ly-clear-hierarchy` · `de-consistent-radius` ·
`mo-gpu-only-props` · `mo-honor-reduced-motion` · `st-design-empty-error` · `a11y-contrast-aa`.
(Marcados `**core: yes**` em `df-rules-library.md`.)

---

## 7. Plano de produção

A biblioteca de rules é a maior frente. Produzir como **spec primeiro** em
`docs/specs/df-rules-library.md` (não toca código), em batch validado:

1. **Amostra** — 1 categoria completa (anti-slop) no formato final → founder valida profundidade/voz.
2. **Batch** — as 13 categorias restantes, paralelizadas, no mesmo formato → revisão de consistência.
3. **Porte** — estender o tipo `Rule` (tier/core/checkable) em `rules-taxonomy.ts` + carregar a biblioteca.
4. **Default editável** — setting `default_rule_ids` (factory = `core`) + painel de config (espelha
   `CanvasPresetsEditor`); picker inicia da default (`NewProjectFormSkeu`); override por projeto.
5. **static-p0** — checks grep-able (P0/P1/P2) + status `craft-warn` + UI auto-fix.
6. **Prompt magro + agent-contract** — `GENERATE_CORE_SYSTEM` enxuto; `agent-contract §6` = don'ts.

Cada passo de código com `vitest run` passando. Builder (`system-backend`) implementa no DF.
**Prova real:** gerar o mesmo brief antes/depois com ≥1 provider e comparar craft.

---

## 8. Riscos e questões abertas

- **Inflar UI/prompt** (50 → ~131 rules + 30 checks). Mitiga: core enxuto (10-15), checks são
  camada separada (não viram texto), a grande maioria das rules é opt-in (não entra por geração).
  Custo real fica no picker/UI da biblioteca, não no prompt.
- **Falso-positivo no grep** → rede só *sinaliza* (não bloqueia), só padrões de alta confiança.
- **Modelos fracos** (Flash Lite, Ollama) → a rede determinística é a rede de segurança deles.
- **Aberto:** `GENERATE_CORE_SYSTEM` é editável em Settings — se houver override salvo no db,
  a mudança no default não pega. Verificar antes de validar a geração.
- **Aberto:** ok do founder na lista de 10 core + 15 novas.

---

## 9. Fontes

- Jakub Krehel — jakub.kr (writing/less-is-more · details-that-make-interfaces-feel-better ·
  work/using-ai-as-a-design-engineer · gradients · oklch-colors · motion-gestures · drag-gesture ·
  will-change-in-css · shared-layout-animations)
- vibecoded-design-tells — github.com/JCarterJohnson/vibecoded-design-tells
- aifire — aifire.co/p/building-premium-ai-built-websites-2026-design-guide
- Anthony Hobday · Refactoring UI · Erik Kennedy · open-design · Elkholy · Rauno Freiberg
  (rauno.me, interfaces.rauno.me, devouringdetails.com) · Emil Kowalski · Josh Comeau ·
  Cassie Evans/GSAP · web.dev/Argyle · Material Design 3 · Matthew Ström · Evil Martians ·
  Radix Colors · Matthew Butterick
  (URLs completas no §5.2)
