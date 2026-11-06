/**
 * Which TeX engine compiles a project, for compiles that don't run in
 * the desktop app (the browser build). A port of the engine choice in
 * src-tauri/src/profile.rs: the project setting, else a `% !TEX
 * program` comment in the main file, else a latexmkrc's `$pdf_mode`,
 * else a guess from the packages and classes the preamble loads
 * (following the project's own .cls and .sty files), else pdflatex.
 * Keep the two in step.
 */

import type { ProjectConfig, TexEngine } from "@/lib/tauri";

export function parseEngine(name: string): TexEngine | null {
  switch (name.trim().toLowerCase()) {
    case "pdflatex":
    case "pdftex":
      return "pdflatex";
    case "xelatex":
    case "xetex":
      return "xelatex";
    case "lualatex":
    case "luatex":
      return "lualatex";
    default:
      return null;
  }
}

/** `% !TEX program = xelatex` (or `TS-program`) in the leading comment lines. */
function magicCommentEngine(source: string): TexEngine | null {
  for (const raw of source.split("\n").slice(0, 20)) {
    const line = raw.trim();
    if (line === "") continue;
    if (!line.startsWith("%")) break;
    let rest = line.replace(/^%+/, "").trim();
    if (!rest.startsWith("!")) continue;
    rest = rest.slice(1).trim();
    if (rest.slice(0, 3).toLowerCase() !== "tex") continue;
    const lower = rest.slice(3).trim().toLowerCase();
    const key = lower.startsWith("ts-program")
      ? "ts-program"
      : lower.startsWith("program")
        ? "program"
        : null;
    if (key === null) continue;
    const value = lower.slice(key.length).trim();
    if (value.startsWith("=")) return parseEngine(value.slice(1));
  }
  return null;
}

/** `$pdf_mode = 4` (lualatex) or `5` (xelatex) in a latexmkrc, read, never run. */
function latexmkrcEngine(source: string): TexEngine | null {
  let engine: TexEngine | null = null;
  for (const line of source.split("\n")) {
    const code = line.split("#")[0].trim();
    if (!code.startsWith("$pdf_mode")) continue;
    const rest = code.slice("$pdf_mode".length).trimStart();
    if (!rest.startsWith("=")) continue;
    const value = rest.slice(1).trim().replace(/;+$/, "").trim();
    if (value === "1") engine = "pdflatex";
    else if (value === "4") engine = "lualatex";
    else if (value === "5") engine = "xelatex";
  }
  return engine;
}

const LUA_PACKAGES = [
  "luatexja",
  "ltjs",
  "ltjt",
  "luacode",
  "luatextra",
  "luamplib",
  "lualatex-math",
];
const XE_PACKAGES = [
  "fontspec",
  "unicode-math",
  "polyglossia",
  "mathspec",
  "xunicode",
  "xltxtra",
  "fontsetup",
  "xeCJK",
  "ctex",
];

/** The engine a package or class needs, for those that only work on XeTeX or LuaTeX. */
function packageEngine(name: string): TexEngine | null {
  if (LUA_PACKAGES.some((p) => name.startsWith(p))) return "lualatex";
  if (XE_PACKAGES.some((p) => name.startsWith(p))) return "xelatex";
  return null;
}

const LOADERS: [string, string][] = [
  ["\\usepackage", ".sty"],
  ["\\RequirePackage", ".sty"],
  ["\\documentclass", ".cls"],
  ["\\LoadClass", ".cls"],
];

/** The packages and classes a file's preamble loads, in order, with `.sty` or `.cls`. */
function loadedFiles(source: string): string[] {
  const end = source.indexOf("\\begin{document}");
  const preamble = end >= 0 ? source.slice(0, end) : source;
  const code = preamble
    .split("\n")
    .map((line) => line.split("%")[0])
    .join("\n");
  const found: [number, string][] = [];
  for (const [command, ext] of LOADERS) {
    let at = code.indexOf(command);
    while (at >= 0) {
      let rest = code.slice(at + command.length).trimStart();
      let ok = true;
      if (rest.startsWith("[")) {
        const close = rest.indexOf("]");
        if (close < 0) ok = false;
        else rest = rest.slice(close + 1).trimStart();
      }
      if (ok && rest.startsWith("{")) {
        const close = rest.indexOf("}");
        if (close >= 0) {
          for (const name of rest.slice(1, close).split(",")) {
            if (name.trim() !== "") found.push([at, name.trim() + ext]);
          }
        }
      }
      at = code.indexOf(command, at + command.length);
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, file]) => file);
}

const ENGINE_TESTS = [
  "\\ifxetex",
  "\\ifluatex",
  "\\iftutex",
  "\\ifpdftex",
  "\\ifPDFTeX",
  "\\ifXeTeX",
  "\\ifLuaTeX",
  "\\sys_if_engine",
];

function packagesEngine(
  source: string,
  mainDir: string,
  read: (path: string) => string | null,
  seen: string[],
): TexEngine | null {
  for (const file of loadedFiles(source)) {
    const engine = packageEngine(file.replace(/\.(sty|cls)$/, ""));
    if (engine) return engine;
    if (seen.length >= 20 || seen.includes(file)) continue;
    seen.push(file);
    // TeX finds it next to the main file or at the project root.
    const paths = mainDir ? [`${mainDir}/${file}`, file] : [file];
    let own: string | null = null;
    for (const path of paths) {
      own = read(path);
      if (own !== null) break;
    }
    // A class or package that tests the engine works on all of them.
    if (own !== null && !ENGINE_TESTS.some((test) => own.includes(test))) {
      const inner = packagesEngine(own, mainDir, read, seen);
      if (inner) return inner;
    }
  }
  return null;
}

/** The engine for a compile; `read` returns a project file by its path, or null. */
export function resolveEngine(
  config: ProjectConfig,
  mainTex: string,
  mainSource: string,
  read: (path: string) => string | null = () => null,
): TexEngine {
  const set = config.engine ? parseEngine(config.engine) : null;
  if (set) return set;
  const magic = magicCommentEngine(mainSource);
  if (magic) return magic;
  const slash = mainTex.lastIndexOf("/");
  const mainDir = slash >= 0 ? mainTex.slice(0, slash) : "";
  for (const folder of mainDir ? [`${mainDir}/`, ""] : [""]) {
    for (const name of ["latexmkrc", ".latexmkrc"]) {
      const text = read(folder + name);
      const engine = text === null ? null : latexmkrcEngine(text);
      if (engine) return engine;
    }
  }
  return packagesEngine(mainSource, mainDir, read, []) ?? "pdflatex";
}
