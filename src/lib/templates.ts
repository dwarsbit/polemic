/**
 * The new-project templates, for builds without the desktop app's Rust
 * side (the browser build). src-tauri/src/templates.rs is the one table
 * of templates: this module reads that file's source at build time, so
 * a template added or changed there reaches both builds. The parser
 * knows only the shapes that file uses (see templates.test.ts).
 */

import source from "../../src-tauri/src/templates.rs?raw";
import type { TemplateInfo } from "@/lib/tauri";

export interface Template extends TemplateInfo {
  /** The files a new project starts with, by path. */
  files: { path: string; text: string }[];
}

/** A Rust "..." literal's text; its escapes are JSON's for what the table uses. */
const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
/** A Rust r"..." literal, which cannot hold a quote. */
const RAW = String.raw`r"([^"]*)"`;

const unquote = (escaped: string) => JSON.parse(`"${escaped}"`) as string;

function field(block: string, name: string): string {
  const match = new RegExp(String.raw`\b${name}:\s*${STRING}`).exec(block);
  if (!match) throw new Error(`templates.rs: a template has no ${name}`);
  return unquote(match[1]);
}

export function parseTemplates(rust: string): Template[] {
  // Top-level `const NAME: &str = r"...";`, which file entries may name.
  const constants = new Map<string, string>();
  for (const match of rust.matchAll(
    new RegExp(String.raw`^const ([A-Z_]+): &str = ${RAW};`, "gm"),
  )) {
    constants.set(match[1], match[2]);
  }
  const table = rust.indexOf("pub const TEMPLATES");
  if (table < 0) throw new Error("templates.rs: no TEMPLATES table");
  const end = rust.indexOf("\n];", table);
  const blocks = rust
    .slice(table, end)
    .split(/\bTemplate \{/)
    .slice(1);
  return blocks.map((block) => {
    const filesAt = block.indexOf("files:");
    const requiresAt = block.indexOf("requires:");
    const files = [
      ...block
        .slice(filesAt, requiresAt)
        .matchAll(
          new RegExp(String.raw`\(\s*${STRING},\s*(?:${RAW}|([A-Z_]+))\s*,?\s*\)`, "g"),
        ),
    ].map((match) => {
      const text = match[2] ?? constants.get(match[3]);
      if (text === undefined) throw new Error(`templates.rs: no constant ${match[3]}`);
      return { path: unquote(match[1]), text };
    });
    const requires = [
      ...block
        .slice(requiresAt)
        .matchAll(
          new RegExp(String.raw`file:\s*${STRING},\s*package:\s*${STRING}`, "g"),
        ),
    ].map((match) => ({ file: unquote(match[1]), package: unquote(match[2]) }));
    return {
      id: field(block, "id"),
      name: field(block, "name"),
      description: field(block, "description"),
      requires,
      files,
    };
  });
}

export const TEMPLATES: Template[] = parseTemplates(source);

/** The templates as `list_templates` answers: without their files. */
export const templateInfos = (): TemplateInfo[] =>
  TEMPLATES.map(({ id, name, description, requires }) => ({
    id,
    name,
    description,
    requires,
  }));
