// Validate and apply the model's search/replace edits. LLM output is untrusted:
// these checks are a security control, not style.
import { writeFile } from "node:fs/promises";
import type { SourceFile } from "./mapping.ts";
import type { Edit } from "./schema.ts";
import { checkSyntax } from "./syntax.ts";

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

export interface FilePlan {
  file: SourceFile;
  edits: Edit[];
  /** New content when every edit for the file applies and the result parses. */
  content: string | null;
  /** Why the file's edits were rejected. All-or-nothing per file. */
  error: string | null;
}

export interface EditPlan {
  files: FilePlan[];
  /** Edits naming a file the call was not allowed to touch. */
  disallowed: { edit: Edit; reason: string }[];
}

/**
 * Pure. Groups edits by file, applies each file's edits in order to the
 * current content and parse-checks the result. A file is rejected as a whole
 * if any edit is not unique, is a no-op, or the result does not parse:
 * partial application could leave half a fix (e.g. aria-labelledby without
 * the element it points to).
 */
export function planEdits(edits: Edit[], allowed: SourceFile[]): EditPlan {
  const byRel = new Map(allowed.map((f) => [f.rel, f]));
  const grouped = new Map<SourceFile, Edit[]>();
  const disallowed: EditPlan["disallowed"] = [];
  for (const edit of edits) {
    const file = byRel.get(normaliseRel(edit.file));
    if (!file) {
      disallowed.push({ edit, reason: `${edit.file} is not an editable file for this violation` });
      continue;
    }
    grouped.set(file, [...(grouped.get(file) ?? []), edit]);
  }

  const files: FilePlan[] = [];
  for (const [file, fileEdits] of grouped) {
    let content = file.content;
    let error: string | null = null;
    for (const edit of fileEdits) {
      if (edit.oldStr === edit.newStr) {
        error = "edit does not change anything";
        break;
      }
      const n = countOccurrences(content, edit.oldStr);
      if (n !== 1) {
        error = n === 0 ? "oldStr not found in the file" : `oldStr occurs ${n} times, it must be unique`;
        break;
      }
      const at = content.indexOf(edit.oldStr);
      content = content.slice(0, at) + edit.newStr + content.slice(at + edit.oldStr.length);
    }
    if (!error) {
      const syntax = checkSyntax(file.path, content);
      if (syntax) error = `result does not parse: ${syntax}`;
    }
    files.push({ file, edits: fileEdits, content: error ? null : content, error });
  }
  return { files, disallowed };
}

/** Model-written paths: trim, forward slashes, no leading ./ */
export function normaliseRel(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Write accepted files to disk and update the in-memory copies. */
export async function writePlan(plan: EditPlan): Promise<void> {
  for (const fp of plan.files) {
    if (fp.content === null) continue;
    await writeFile(fp.file.path, fp.content);
    fp.file.content = fp.content;
  }
}

/** Restore files to the given contents (used when a project-wide check fails). */
export async function revertFiles(files: { file: SourceFile; previous: string }[]): Promise<void> {
  for (const { file, previous } of files) {
    await writeFile(file.path, previous);
    file.content = previous;
  }
}
