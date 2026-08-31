#!/usr/bin/env node
/**
 * Starts the Tinyhouse app and the Python engine together.
 *
 *   npm start            # or: node scripts/dev.mjs
 *
 * Ports are picked at run time — each is probed and the next free one is used
 * if something else already holds it — and the web app is told where the
 * engine landed through ENGINE_URL. Ctrl+C stops both.
 *
 * Options (all optional):
 *   --web-port <n>       first port to try for Next.js      (default 3000)
 *   --engine-port <n>    first port to try for the engine   (default 8000)
 *   --python <cmd>       Python executable to use
 *   --no-engine          run the web app on its own
 *   --build              serve a production build instead of the dev server
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_DIR = path.join(ROOT, "engine");
const IS_WINDOWS = process.platform === "win32";

const COLOURS = {
  web: "\u001b[36m", // cyan
  engine: "\u001b[35m", // magenta
  info: "\u001b[32m", // green
  warn: "\u001b[33m",
  error: "\u001b[31m",
  dim: "\u001b[2m",
  reset: "\u001b[0m",
};

function log(channel, message) {
  const colour = COLOURS[channel] ?? "";
  const label = channel === "info" ? "tinyhouse" : channel;
  process.stdout.write(`${colour}[${label}]${COLOURS.reset} ${message}\n`);
}

// --- arguments ---------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    webPort: Number(process.env.PORT) || 3000,
    enginePort: Number(process.env.ENGINE_PORT) || 8000,
    python: process.env.PYTHON || null,
    engine: true,
    build: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--web-port") options.webPort = Number(argv[++i]);
    else if (arg === "--engine-port") options.enginePort = Number(argv[++i]);
    else if (arg === "--python") options.python = argv[++i];
    else if (arg === "--no-engine") options.engine = false;
    else if (arg === "--build") options.build = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: node scripts/dev.mjs [--web-port n] [--engine-port n] " +
          "[--python cmd] [--no-engine] [--build]\n",
      );
      process.exit(0);
    } else {
      log("warn", `ignoring unknown option ${arg}`);
    }
  }
  return options;
}

// --- ports -------------------------------------------------------------------

/** True when nothing is listening on the port, on any interface. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen({ port, host: "0.0.0.0", exclusive: true });
  });
}

async function findPort(preferred, label) {
  for (let port = preferred; port < preferred + 100; port++) {
    if (await isPortFree(port)) {
      if (port !== preferred) {
        log("warn", `port ${preferred} is busy, using ${port} for the ${label}`);
      }
      return port;
    }
  }
  throw new Error(`no free port for the ${label} near ${preferred}`);
}

// --- processes ---------------------------------------------------------------

const children = [];
let shuttingDown = false;

/**
 * Streams a child's output with a prefix. npm/next spawn their own children on
 * Windows, so the whole tree is killed rather than just the process we hold.
 */
function start(channel, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);

  const forward = (stream) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) log(channel, line);
      }
    });
  };
  forward(child.stdout);
  forward(child.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown || options.ignoreExit) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    if (options.optional) {
      log("warn", `${channel} stopped (${reason})`);
      return;
    }
    log("error", `${channel} stopped (${reason}) — shutting everything down`);
    shutdown(code ?? 1);
  });

  return child;
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WINDOWS) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 300);
}

// --- python ------------------------------------------------------------------

async function findPython(preferred) {
  const candidates = preferred
    ? [preferred]
    : IS_WINDOWS
      ? ["python", "py", "python3"]
      : ["python3", "python"];
  for (const candidate of candidates) {
    const args = candidate === "py" ? ["-3", "--version"] : ["--version"];
    const probe = spawn(candidate, args, { stdio: "ignore", windowsHide: true });
    const [code] = await once(probe, "exit").catch(() => [1]);
    if (code === 0) return candidate;
  }
  return null;
}

/** Polls /health until the engine answers, or gives up. */
async function waitForEngine(port, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    if (shuttingDown) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// --- main --------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const enginePort = options.engine ? await findPort(options.enginePort, "engine") : null;
  const webPort = await findPort(options.webPort, "web app");
  const engineUrl = enginePort ? `http://127.0.0.1:${enginePort}` : null;

  if (options.engine) {
    const python = await findPython(options.python);
    if (!python) {
      log(
        "warn",
        "no Python found — the board still works, but bot play and game review " +
          "will not. Install Python 3.10+ or pass --python <path>.",
      );
    } else {
      const args = python === "py" ? ["-3", "-m"] : ["-m"];
      start(
        "engine",
        python,
        [...args, "tinyhouse", "serve", "--port", String(enginePort)],
        { cwd: ENGINE_DIR, optional: true, env: { PYTHONUNBUFFERED: "1" } },
      );
      log("info", `starting the engine on ${engineUrl}`);
      if (await waitForEngine(enginePort)) log("info", "engine ready");
      else log("warn", "engine did not answer /health — bot play may be unavailable");
    }
  }

  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const nextArgs = options.build
    ? ["start", "--port", String(webPort)]
    : ["dev", "--port", String(webPort)];

  if (options.build) {
    log("info", "building for production…");
    const build = start("web", process.execPath, [nextBin, "build"], { ignoreExit: true });
    const [code] = await once(build, "exit");
    if (code !== 0) {
      log("error", "build failed");
      shutdown(code ?? 1);
      return;
    }
  }

  start("web", process.execPath, [nextBin, ...nextArgs], {
    env: engineUrl ? { ENGINE_URL: engineUrl, PORT: String(webPort) } : { PORT: String(webPort) },
  });

  log("info", `app on ${COLOURS.web}http://localhost:${webPort}${COLOURS.reset}`);
  log("info", `${COLOURS.dim}press Ctrl+C to stop both${COLOURS.reset}`);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    log("info", "stopping…");
    shutdown(0);
  });
}
process.on("exit", () => {
  for (const child of children) killTree(child);
});

main().catch((error) => {
  log("error", error.message);
  shutdown(1);
});
