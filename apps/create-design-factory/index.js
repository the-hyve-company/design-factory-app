#!/usr/bin/env node
// create-design-factory — scaffolder do Design Factory.
//
// Roda via `npm create design-factory` ou `npx create-design-factory`.
// Baixa o repo público via tarball HTTPS (sem dep de git instalado),
// extrai no diretório-alvo, roda `npm install` e (por default) `npm run dev:web`.
//
// Cross-platform: Mac, Linux, Windows. Todo spawn() usa shell:true no Windows
// (CVE-2024-27980 — npm.cmd lança spawn EINVAL sem shell).

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
import { createWriteStream } from "node:fs";
import { x as tarExtract } from "tar";

const REPO = "the-hyve-company/design-factory";
const TARBALL_BASE = `https://codeload.github.com/${REPO}/tar.gz`;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  orange: "\x1b[38;5;208m",
};

function log(msg) {
  process.stdout.write(msg + "\n");
}

function die(msg, code = 1) {
  process.stderr.write(`\n${C.red}${C.bold}error:${C.reset} ${msg}\n\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    dir: "design-factory",
    branch: "main",
    install: true,
    dev: true,
    force: false,
    // git: try `git clone` when available (so future `git pull` works).
    // false = force tarball mode (legacy behavior).
    git: true,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--dir" || a === "-d") {
      args.dir = rest[++i] || args.dir;
    } else if (a === "--branch" || a === "-b") {
      args.branch = rest[++i] || args.branch;
    } else if (a === "--no-install") {
      args.install = false;
      args.dev = false; // sem install não tem dev
    } else if (a === "--no-dev") {
      args.dev = false;
    } else if (a === "--no-git") {
      // Force tarball mode even when git is available. Useful for CI
      // / smoke tests that want deterministic offline-ish behavior.
      args.git = false;
    } else if (a === "--force" || a === "-f") {
      args.force = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-") && args.dir === "design-factory") {
      // Primeiro positional vira o dir.
      args.dir = a;
    }
  }
  return args;
}

function printHelp() {
  log(`
${C.bold}create-design-factory${C.reset} — scaffolder do Design Factory

${C.bold}Uso:${C.reset}
  npm create design-factory [nome-do-dir] [opções]

${C.bold}Opções:${C.reset}
  --dir <nome>       Nome do diretório (default: design-factory)
  --branch <nome>    Branch do repo a baixar (default: main)
  --no-install       Pula \`npm install\` no fim
  --no-dev           Não roda \`npm run dev:web\` no fim
  --no-git           Força modo tarball (sem .git/, sem \`git pull\` futuro)
  --force            Sobrescreve diretório existente
  -h, --help         Mostra esta ajuda

${C.bold}Requisitos:${C.reset}
  Node 20+

${C.bold}Exemplo:${C.reset}
  npm create design-factory          # cria ./design-factory
  npm create design-factory meu-df   # cria ./meu-df
  npm create design-factory --no-dev # baixa + instala, sem rodar dev
`);
}

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 20) {
    die(
      `Design Factory exige Node 20 ou superior.\n` +
        `Você está usando Node ${process.versions.node}.\n\n` +
        `Instale uma versão recente em https://nodejs.org/`,
    );
  }
}

function downloadTarball(url, outPath) {
  return new Promise((resolveP, rejectP) => {
    function fetch(currentUrl, redirects = 0) {
      if (redirects > 5) return rejectP(new Error("Muitos redirects"));
      httpsGet(currentUrl, (res) => {
        // Handle 301/302/307/308
        if (
          [301, 302, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          return fetch(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return rejectP(
            new Error(`Download falhou: HTTP ${res.statusCode} em ${currentUrl}`),
          );
        }
        const file = createWriteStream(outPath);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolveP(outPath)));
        file.on("error", rejectP);
      }).on("error", rejectP);
    }
    fetch(url);
  });
}

/** Detect if `git` is available on PATH. Returns the version string on
 *  success, null when the binary isn't found / errors out. Used to
 *  decide between the git-clone path (preferred — gives the user a real
 *  repo for future `git pull`) and the tarball fallback (worked from
 *  v0.1.0 onwards but produces a flat folder with no `.git/`). */
async function detectGit() {
  return new Promise((resolveP) => {
    try {
      const child = spawn("git", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      let out = "";
      child.stdout?.on("data", (b) => { out += b.toString("utf8"); });
      child.on("error", () => resolveP(null));
      child.on("close", (code) => {
        if (code !== 0) return resolveP(null);
        const match = out.match(/git version (\S+)/);
        resolveP(match ? match[1] : "unknown");
      });
      // Hard timeout so a slow git install doesn't hang the scaffolder.
      setTimeout(() => { try { child.kill(); } catch {} resolveP(null); }, 3000);
    } catch {
      resolveP(null);
    }
  });
}

async function spawnAwait(cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    // SIGINT propagation — ctrl+c no parent encerra child.
    const onSignal = (sig) => child.kill(sig);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    child.on("close", (code, signal) => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} ${args.join(" ")} saiu com código ${code ?? signal}`));
    });
    child.on("error", rejectP);
  });
}

async function main() {
  checkNodeVersion();

  const args = parseArgs(process.argv);
  const targetDir = resolve(process.cwd(), args.dir);
  const dirName = basename(targetDir);

  log(`${C.orange}${C.bold}Design Factory${C.reset} ${C.dim}— scaffolder v0.2.0${C.reset}\n`);

  // Verifica conflito com diretório existente.
  if (existsSync(targetDir)) {
    const stat = statSync(targetDir);
    if (!stat.isDirectory()) {
      die(`${targetDir} existe e não é um diretório.`);
    }
    if (!args.force) {
      die(
        `Diretório ${C.bold}${dirName}${C.reset} já existe.\n` +
          `Use ${C.cyan}--force${C.reset} para sobrescrever ou escolha outro nome.`,
      );
    }
    log(`${C.yellow}→${C.reset} removendo ${dirName}/ existente (--force)`);
    rmSync(targetDir, { recursive: true, force: true });
  }

  // Prefer git clone when available: gives the user a real repo so
  // future updates work with `git pull`. Falls back to tarball if git
  // isn't installed, or the user passed --no-git. Founder hit this:
  // ran `npm create design-factory`, later tried `git pull`, got
  // "not a git repository" — there was no `.git/` because tarball.
  const gitVersion = args.git ? await detectGit() : null;
  if (gitVersion) {
    // git clone needs to OWN the target dir creation (it errors if the
    // dir exists and isn't empty). We didn't pre-mkdir.
    log(`${C.cyan}→${C.reset} clonando ${REPO}@${args.branch} via git ${C.dim}(${gitVersion})${C.reset}…`);
    try {
      await spawnAwait("git", [
        "clone",
        "--depth=1",
        "--branch", args.branch,
        `https://github.com/${REPO}.git`,
        targetDir,
      ]);
    } catch (err) {
      rmSync(targetDir, { recursive: true, force: true });
      die(
        `Falha em \`git clone\`.\n` +
          `Motivo: ${err.message}\n\n` +
          `Alternativa: rode novamente com ${C.cyan}--no-git${C.reset} pra usar o tarball.`,
      );
    }
  } else {
    if (args.git) {
      log(`${C.yellow}→${C.reset} git não detectado, caindo pro tarball ${C.dim}(\`git pull\` futuro não vai funcionar; reinstale git pra ter um repo updateable)${C.reset}`);
    }
    mkdirSync(targetDir, { recursive: true });
    const tarPath = pjoin(tmpdir(), `design-factory-${Date.now()}.tar.gz`);
    const tarballUrl = `${TARBALL_BASE}/${args.branch}`;
    log(`${C.cyan}→${C.reset} baixando ${REPO}@${args.branch} via tarball…`);
    try {
      await downloadTarball(tarballUrl, tarPath);
    } catch (err) {
      rmSync(targetDir, { recursive: true, force: true });
      die(
        `Falha ao baixar ${tarballUrl}\n` +
          `Motivo: ${err.message}\n\n` +
          `Verifique a conexão. Alternativa manual:\n` +
          `  ${C.cyan}git clone https://github.com/${REPO}.git ${dirName}${C.reset}\n` +
          `  ${C.cyan}cd ${dirName}${C.reset}\n` +
          `  ${C.cyan}npm install${C.reset}\n` +
          `  ${C.cyan}npm run dev:web${C.reset}`,
      );
    }
    log(`${C.cyan}→${C.reset} extraindo em ${dirName}/`);
    try {
      await tarExtract({ file: tarPath, cwd: targetDir, strip: 1 });
    } catch (err) {
      rmSync(targetDir, { recursive: true, force: true });
      die(`Falha ao extrair tarball: ${err.message}`);
    } finally {
      try { rmSync(tarPath, { force: true }); } catch { /* ignore */ }
    }
  }

  // npm install.
  if (args.install) {
    log(`${C.cyan}→${C.reset} instalando dependências (pode demorar)…`);
    try {
      await spawnAwait("npm", ["install"], { cwd: targetDir });
    } catch (err) {
      die(
        `Falha em \`npm install\`.\n` +
          `Motivo: ${err.message}\n\n` +
          `Você pode tentar manualmente:\n` +
          `  ${C.cyan}cd ${dirName} && npm install${C.reset}`,
      );
    }
  }

  log(``);
  log(`${C.green}${C.bold}Pronto.${C.reset} Design Factory instalado em ${C.bold}${dirName}/${C.reset}`);

  // npm run dev:web — opcional, default true.
  if (args.dev && args.install) {
    log(`${C.cyan}→${C.reset} iniciando dev server (Ctrl+C para parar)…\n`);
    try {
      await spawnAwait("npm", ["run", "dev:web"], { cwd: targetDir });
    } catch (err) {
      // dev server interrompido pelo usuário (Ctrl+C) é OK.
      if (!/exited with code/.test(err.message)) {
        log(`\n${C.yellow}dev server encerrado: ${err.message}${C.reset}`);
      }
    }
  } else {
    log(``);
    log(`${C.dim}Próximos passos:${C.reset}`);
    log(`  ${C.cyan}cd ${dirName}${C.reset}`);
    if (!args.install) log(`  ${C.cyan}npm install${C.reset}`);
    log(`  ${C.cyan}npm run dev:web${C.reset}`);
    log(``);
  }
}

main().catch((err) => {
  die(err.stack || err.message);
});
