# create-design-factory

Scaffolder do [Design Factory](https://github.com/the-hyve-company/design-factory-app) — workspace local-first para criar e manipular design com IA.

## Uso

```bash
npm create design-factory
```

Baixa o repo, instala dependências e abre o app em `localhost:1420`. Pronto.

## Opções

```bash
npm create design-factory [nome-do-dir] [opções]
```

| Flag              | Default          | Descrição                               |
| ----------------- | ---------------- | --------------------------------------- |
| `--dir <nome>`    | `design-factory` | Nome do diretório a criar               |
| `--branch <nome>` | `main`           | Branch do repo a baixar                 |
| `--no-install`    | —                | Pula `npm install`                      |
| `--no-dev`        | —                | Não inicia o app (`npm start`) no final |
| `--force`         | —                | Sobrescreve diretório existente         |
| `-h`, `--help`    | —                | Mostra ajuda                            |

Exemplos:

```bash
npm create design-factory                   # cria ./design-factory
npm create design-factory meu-df            # cria ./meu-df
npm create design-factory --no-dev          # baixa + instala, sem rodar dev
npm create design-factory --branch develop  # baixa branch específica
```

## Requisitos

- Node 20+
- npm (vem com Node)
- Conexão de internet

## Como funciona

1. Baixa o tarball do repo via HTTPS (sem necessidade de `git` instalado)
2. Extrai no diretório-alvo
3. Roda `npm install`
4. Roda `npm start` — compila o build otimizado e serve (a menos que `--no-dev`)

Cross-platform: Mac, Linux, Windows.

## Plano B (se falhar)

```bash
git clone https://github.com/the-hyve-company/design-factory-app.git
cd design-factory-app
npm install
npm start
```

## Licença

Apache-2.0 — mesma do Design Factory.
