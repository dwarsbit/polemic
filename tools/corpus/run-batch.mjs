#!/usr/bin/env node
/* global process, console, setTimeout, clearTimeout, fetch, AbortSignal, Buffer */
// Compiles the next batch of the LaTeX corpus (catalog.json) twice: through Polemic's compile
// service, as a user's cloud compile would, and with plain latexmk in the same TeX Live as a
// baseline. Keeps every log, the issues the editor would show, and a result per project.
//
//   node run-batch.mjs --results <dir> [--size 100] [--service http://127.0.0.1:8080]
//                      [--image polemic-compile] [--probe <corpus-probe binary>]
//
// <dir> holds state.json (where the next batch starts), batches/NNNN.jsonl, logs/<id>/ and
// SUMMARY.md. Needs git, tar, unzip, gzip and docker on the PATH.

import { execFile } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const RESULTS = option("results");
const SIZE = Number(option("size", "100"));
const SERVICE = option("service", "http://127.0.0.1:8080");
const IMAGE = option("image", "polemic-compile");
const PROBE = option("probe", join(here, "probe/target/release/corpus-probe"));
const WORKERS = Number(option("workers", "2"));
const TIMEOUT_S = 240; // the compile service's own limit
const UA = "polemic-corpus-test (https://github.com/dwarsbit/polemic)";
if (!RESULTS) {
  console.error("usage: node run-batch.mjs --results <dir> [--size 100]");
  process.exit(2);
}

const sh = (cmd, args, opts = {}) =>
  run(cmd, args, { maxBuffer: 256 * 1024 * 1024, encoding: "utf8", ...opts });

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

// --- download -------------------------------------------------------------------------------

let arxivTurn = Promise.resolve();
/** arXiv asks for one request every few seconds. */
function arxivSlot() {
  const mine = arxivTurn.then(() => new Promise((r) => setTimeout(r, 4000)));
  arxivTurn = mine;
  return mine;
}

async function fetchTo(url, file) {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** Moves the only folder of `dir` up, for archives that wrap everything in one. */
async function unwrap(dir) {
  const entries = (await readdir(dir)).filter((e) => e !== "__MACOSX");
  if (entries.length !== 1) return dir;
  const only = join(dir, entries[0]);
  return (await stat(only)).isDirectory() ? only : dir;
}

async function download(entry, dir) {
  await mkdir(dir, { recursive: true });
  if (entry.source === "GitHub") {
    await sh("git", ["clone", "--quiet", "--depth", "1", `${entry.url}.git`, dir], {
      timeout: 600_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const { stdout } = await sh("git", ["-C", dir, "rev-parse", "HEAD"]);
    await rm(join(dir, ".git"), { recursive: true, force: true });
    return { root: dir, version: stdout.trim() };
  }
  if (entry.source === "arXiv") {
    await arxivSlot();
    const file = join(dirname(dir), "eprint");
    await fetchTo(`https://arxiv.org/e-print/${entry.arxiv}`, file);
    let data = await readFile(file);
    if (data.subarray(0, 4).toString() === "%PDF") throw new Error("arXiv has only a PDF of this paper");
    if (data[0] === 0x1f && data[1] === 0x8b) {
      await sh("gzip", ["-dc", file], { encoding: "buffer" }).then(({ stdout }) => (data = stdout));
    }
    if (data.subarray(257, 262).toString() === "ustar") {
      await writeFile(file, data);
      await sh("tar", ["-xf", file, "-C", dir, "--no-same-owner", "--no-same-permissions"]);
    } else {
      await writeFile(join(dir, `${entry.arxiv.replace("/", "-")}.tex`), data);
    }
    return { root: dir, version: entry.arxiv };
  }
  if (entry.source === "CTAN") {
    const res = await fetch(`https://ctan.org/json/2.0/pkg/${encodeURIComponent(entry.ctan)}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(60_000),
    });
    const pkg = await res.json();
    if (!pkg?.ctan?.path) throw new Error("CTAN has no download for this package");
    const zip = join(dirname(dir), "package.zip");
    await fetchTo(`https://mirrors.ctan.org${pkg.ctan.path}.zip`, zip);
    await sh("unzip", ["-q", "-o", zip, "-d", dir]);
    return { root: await unwrap(dir), version: pkg.version?.number ?? pkg.version?.date ?? "" };
  }
  throw new Error(`no download for ${entry.source}`);
}

// --- Polemic's side --------------------------------------------------------------------------

/** As the editor: main.tex, else the first .tex (nearest the root, then by name) with a \documentclass. */
async function polemicMain(root, files) {
  if (files.includes("main.tex")) return "main.tex";
  const tex = files
    .filter((f) => f.endsWith(".tex"))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const path of tex.slice(0, 50)) {
    const text = await readFile(join(root, path), "utf8").catch(() => "");
    if (/^[^%\n]*\\documentclass/m.test(text)) return path;
  }
  return tex[0] ?? null;
}

async function polemicCompile(root, files, main, engine, work) {
  const list = join(work, "files.txt");
  await writeFile(list, files.join("\0"));
  const request = join(work, "request.tar");
  // The editor uploads what a link inside the project points to, so links go as files.
  await sh("tar", ["--format=pax", "--dereference", "--hard-dereference", "--null", "-cf", request, "-C", root, "-T", list]);
  const url = `${SERVICE}/jobs?main=${encodeURIComponent(main)}&engine=${engine}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-tar" },
      body: createReadStream(request),
      duplex: "half",
      signal: AbortSignal.timeout((TIMEOUT_S + 120) * 1000),
    });
    if (res.status === 503 && attempt < 30) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      return { http: res.status, error: body.slice(0, 2000) };
    }
    const answer = join(work, "answer.tar");
    await writeFile(answer, Buffer.from(await res.arrayBuffer()));
    const out = join(work, "answer");
    await mkdir(out);
    await sh("tar", ["-xf", answer, "-C", out]);
    const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
    await writeFile(join(out, "output.txt"), result.output);
    return { http: 200, result, out };
  }
}

async function issuesOf(out) {
  const args = ["issues", join(out, "outputs/log"), join(out, "output.txt")];
  if (existsSync(join(out, "outputs/blg"))) args.push(join(out, "outputs/blg"));
  const { stdout } = await sh(PROBE, args);
  return JSON.parse(stdout);
}

// --- baseline ---------------------------------------------------------------------------------

/** Plain latexmk in the compile image: the project's own latexmkrc, shell escape, no sandbox. */
async function baseline(root, main, engine) {
  const flag = { pdflatex: "-pdf", xelatex: "-xelatex", lualatex: "-lualatex" }[engine];
  const dir = dirname(main) === "." ? "" : dirname(main);
  const file = basename(main);
  const started = Date.now();
  let code = 0;
  let output;
  // The image's own `timeout` exits 125 at once, so the limit is a docker kill.
  const name = `corpus-baseline-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    sh("docker", ["kill", name]).catch(() => {});
  }, TIMEOUT_S * 1000);
  try {
    const r = await sh("docker", [
      "run", "--rm", "--name", name, "--network", "none", "--user", `${process.getuid()}:${process.getgid()}`,
      "-e", "HOME=/tmp", "-e", "TEXMFVAR=/cache/texmf-var",
      "-v", `${root}:/w`, "-v", `${join(tmpdir(), "corpus-cache")}:/cache`,
      "-w", `/w/${dir}`, "--entrypoint", "latexmk", IMAGE,
      flag, "-interaction=nonstopmode", "-shell-escape", "-f", file,
    ]);
    output = r.stdout + r.stderr;
  } catch (err) {
    code = typeof err.code === "number" ? err.code : 1;
    output = `${err.stdout ?? ""}${err.stderr ?? ""}` || String(err.message ?? err);
  } finally {
    clearTimeout(timer);
  }
  const stem = file.replace(/\.tex$/, "");
  // latexmk writes next to the main file unless the project's latexmkrc sets an out_dir.
  const candidates = [join(root, dir), join(root, dir, "build"), join(root, dir, "out"), join(root, dir, "output")];
  let pdf = null;
  let log = null;
  for (const c of candidates) {
    // A PDF the project ships doesn't count: only one written by this run.
    const made = await stat(join(c, `${stem}.pdf`)).catch(() => null);
    if (!pdf && made && made.mtimeMs >= started) pdf = join(c, `${stem}.pdf`);
    if (!log && existsSync(join(c, `${stem}.log`))) log = join(c, `${stem}.log`);
  }
  return {
    ok: code === 0 && pdf !== null,
    exit: code,
    timedOut,
    pdf: pdf !== null,
    durationMs: Date.now() - started,
    output,
    log: log ? await readFile(log, "utf8").catch(() => "") : "",
  };
}

// --- one project ------------------------------------------------------------------------------

function outcomeOf(p, b) {
  if (p.http !== 200) return "polemic-rejected";
  const ok = p.result.status === "success";
  if (ok && b.ok) return "both-ok";
  if (!ok && b.ok) return "polemic-only-fail";
  if (ok && !b.ok) return "baseline-only-fail";
  return p.result.status === "timeout" ? "both-fail-timeout" : "both-fail";
}

const gz = (text) => gzipSync(Buffer.from(text ?? "", "utf8"), { level: 9 });

async function runProject(entry, workRoot, logsDir) {
  const work = await mkdtemp(join(workRoot, `${entry.id}-`));
  const meta = { id: entry.id, source: entry.source, name: entry.name, url: entry.url, type: entry.type };
  const logs = join(logsDir, String(entry.id));
  await rm(logs, { recursive: true, force: true });
  await mkdir(logs, { recursive: true });
  try {
    let dl;
    try {
      dl = await download(entry, join(work, "src"));
    } catch (err) {
      meta.outcome = "download-failed";
      meta.error = String(err.message ?? err).slice(0, 500);
      return meta;
    }
    meta.version = dl.version;
    const files = JSON.parse((await sh(PROBE, ["files", dl.root])).stdout);
    meta.files = files.length;
    const main = await polemicMain(dl.root, files);
    if (!main) {
      meta.outcome = "no-tex";
      return meta;
    }
    meta.main = main;
    if (entry.main && entry.main !== main) meta.catalogMain = entry.main;
    const engine = (await sh(PROBE, ["engine", join(dl.root, main)])).stdout.trim();
    meta.engine = engine;
    if (entry.engine && entry.engine !== engine) meta.detectedEngine = `${entry.engine} (${entry.engineFrom})`;

    // Baseline first, on a copy: the author's main file and engine when we know them.
    const copy = join(work, "baseline");
    await cp(dl.root, copy, { recursive: true, verbatimSymlinks: true });
    const baseMain = entry.main && existsSync(join(copy, entry.main)) ? entry.main : main;
    const baseEngine = entry.engineFrom && entry.engineFrom !== "inferred" ? entry.engine : entry.engine ?? engine;
    const b = await baseline(copy, baseMain, baseEngine);
    meta.baseline = { main: baseMain, engine: baseEngine, ok: b.ok, exit: b.exit, timedOut: b.timedOut, durationMs: b.durationMs };
    if (!b.ok) meta.baseline.tail = `exit ${b.exit}, PDF ${b.pdf ? "found" : "not found"}\n${b.output.trim().split("\n").slice(-8).join("\n")}`;
    await writeFile(join(logs, "baseline-latexmk.txt.gz"), gz(b.output));
    if (b.log) await writeFile(join(logs, "baseline.log.gz"), gz(b.log));

    const p = await polemicCompile(dl.root, files, main, engine, work);
    if (p.http !== 200) {
      meta.polemic = { http: p.http, error: p.error };
    } else {
      const { status, durationMs, outputs } = p.result;
      meta.polemic = { status, durationMs, outputs: outputs.map((o) => o.kind) };
      await writeFile(join(logs, "polemic-latexmk.txt.gz"), gz(p.result.output));
      for (const kind of ["log", "blg"]) {
        const f = join(p.out, "outputs", kind);
        if (existsSync(f)) await writeFile(join(logs, `polemic.${kind}.gz`), gzipSync(await readFile(f), { level: 9 }));
      }
      if (existsSync(join(p.out, "outputs/log"))) {
        const issues = await issuesOf(p.out);
        await writeFile(join(logs, "issues.json"), JSON.stringify(issues, null, 1));
        meta.errors = issues.filter((i) => i.severity === "error").length;
        meta.warnings = issues.length - meta.errors;
        meta.firstError = issues.find((i) => i.severity === "error")?.message?.slice(0, 300);
      }
      // A failure without a parsed error leaves the editor with nothing to show.
      if (status !== "success" && !meta.firstError) meta.polemic.tail = p.result.output.trim().split("\n").slice(-8).join("\n");
    }
    meta.outcome = outcomeOf(p, b);
    return meta;
  } catch (err) {
    meta.outcome = "runner-error";
    meta.error = String(err.stack ?? err).slice(0, 1000);
    return meta;
  } finally {
    await writeFile(join(logs, "meta.json"), JSON.stringify(meta, null, 1));
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// --- summary ----------------------------------------------------------------------------------

const OUTCOMES = {
  "both-ok": "Both compiled",
  "polemic-only-fail": "Failed only in Polemic",
  "baseline-only-fail": "Failed only with plain latexmk",
  "both-fail": "Failed in both",
  "both-fail-timeout": "Timed out in Polemic, failed in both",
  "polemic-rejected": "Polemic refused the project",
  "download-failed": "Download failed",
  "no-tex": "No .tex file",
  "runner-error": "Test runner error",
};

async function summarize(results) {
  const all = [];
  const dir = join(results, "batches");
  for (const f of (await readdir(dir)).sort()) {
    for (const line of (await readFile(join(dir, f), "utf8")).split("\n")) if (line) all.push({ batch: f.slice(0, 4), ...JSON.parse(line) });
  }
  const count = (key) => all.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
  const lines = ["# Corpus test", "", `${all.length} projects in ${new Set(all.map((r) => r.batch)).size} batches.`, ""];
  lines.push("| Outcome | Projects |", "| --- | ---: |");
  for (const [k, v] of Object.entries(count("outcome")).sort((a, b) => b[1] - a[1])) lines.push(`| ${OUTCOMES[k] ?? k} | ${v} |`);
  const table = (title, rows) => {
    if (!rows.length) return;
    lines.push("", `## ${title}`, "", "| Batch | Project | Main file | Engine | First error |", "| --- | --- | --- | --- | --- |");
    for (const r of rows) {
      const err = (r.firstError ?? r.polemic?.error ?? r.error ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);
      lines.push(`| ${r.batch} | [${r.name}](${r.url}) ([logs](logs/${r.id})) | ${r.main ?? ""} | ${r.engine ?? ""} | ${err} |`);
    }
  };
  table("Failed only in Polemic", all.filter((r) => r.outcome === "polemic-only-fail" || r.outcome === "polemic-rejected"));
  table("Main file differs from the author's", all.filter((r) => r.catalogMain).map((r) => ({ ...r, firstError: `author's: ${r.catalogMain}` })));
  lines.push("", "Logs are gzipped: `polemic.log.gz` and `polemic-latexmk.txt.gz` from Polemic, `baseline.*` from plain latexmk, `issues.json` as the editor lists them.");
  await writeFile(join(results, "SUMMARY.md"), lines.join("\n") + "\n");
}

// --- main -------------------------------------------------------------------------------------

const catalog = JSON.parse(await readFile(join(here, "catalog.json"), "utf8"));
await mkdir(join(RESULTS, "batches"), { recursive: true });
await mkdir(join(RESULTS, "logs"), { recursive: true });
await mkdir(join(tmpdir(), "corpus-cache"), { recursive: true });
const state = await readJson(join(RESULTS, "state.json"), { next: 0, batches: 0 });
const todo = catalog.slice(state.next, state.next + SIZE);
if (!todo.length) {
  console.log("Every project in the catalog has been tested.");
  process.exit(0);
}
const batch = String(state.batches + 1).padStart(4, "0");
console.log(`Batch ${batch}: projects ${state.next + 1}–${state.next + todo.length} of ${catalog.length}`);

const workRoot = await mkdtemp(join(tmpdir(), "corpus-"));
const results = [];
let index = 0;
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (index < todo.length) {
      const entry = todo[index++];
      const meta = await runProject(entry, workRoot, join(RESULTS, "logs"));
      results.push(meta);
      console.log(`${String(results.length).padStart(3)} ${meta.outcome.padEnd(20)} ${entry.source.padEnd(7)} ${entry.name}`);
      const why = meta.error ?? meta.polemic?.error ?? (meta.polemic?.status !== "success" ? meta.firstError : null);
      if (why) console.log(`      Polemic: ${why.replace(/\s+/g, " ").slice(0, 300)}`);
      if (meta.polemic?.tail) console.log(meta.polemic.tail.replace(/^/gm, "      Polemic latexmk: "));
      if (meta.baseline?.tail) console.log(meta.baseline.tail.replace(/^/gm, "      latexmk: "));
    }
  }),
);
results.sort((a, b) => todo.findIndex((e) => e.id === a.id) - todo.findIndex((e) => e.id === b.id));
await writeFile(join(RESULTS, "batches", `${batch}.jsonl`), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
await writeFile(join(RESULTS, "state.json"), JSON.stringify({ next: state.next + todo.length, batches: state.batches + 1 }, null, 1) + "\n");
await summarize(RESULTS);
await rm(workRoot, { recursive: true, force: true }).catch(() => {});
