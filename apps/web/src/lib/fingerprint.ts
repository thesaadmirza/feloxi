import type { FailureGroupRow } from "@/types/api";

/// A piece of a normalized exception message: literal text or a named
/// placeholder that stood in for a value (an ID, a URL…).
export type MessagePart = { text: string } | { param: string };

export type ExceptionFingerprint = {
  /// Exception class, e.g. "ValueError". Empty when it can't be parsed.
  type: string;
  /// Message with volatile values replaced by `{name}` placeholders.
  template: string;
  parts: MessagePart[];
  key: string;
};

// Exception class names: optional dotted module path, then a capitalised name.
const CLASS = String.raw`((?:[A-Za-z_]\w*\.)*[A-Z]\w*)`;
const REPR = new RegExp(String.raw`^${CLASS}\((['"])([\s\S]*)\2\)$`);
const REPR_EMPTY = new RegExp(String.raw`^${CLASS}\(\)$`);
const COLON = new RegExp(String.raw`^${CLASS}: ([\s\S]*)$`);

// Order matters: URLs first so their paths aren't picked apart by later rules.
const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  // Lazy, stopping before punctuation that ends the sentence: "…/v.mp4: codec error".
  [/\b(?:https?|s3|gs|ftp|file):\/\/[^\s'"]+?(?=[:,;.)\]]*(?:\s|$))/g, "{url}"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "{uuid}"],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "{email}"],
  // order_82bec913 → {order_id}; needs a digit so words like send_welcome stay.
  [
    /\b([a-z][a-z0-9]*)_(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/gi,
    (_m, prefix: string) => `{${prefix.toLowerCase()}_id}`,
  ],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, "{hex}"],
  [/\b\d{4,}\b/g, "{n}"],
];

/// Exception class and raw message from the first line of a stored
/// exception: `ValueError('boom')`, `ValueError()` or `ValueError: boom`.
export function splitException(raw: string): { type: string; message: string } {
  const firstLine = (raw ?? "").split("\n")[0].trim();
  const repr = REPR.exec(firstLine);
  if (repr) return { type: repr[1], message: repr[3] };
  const empty = REPR_EMPTY.exec(firstLine);
  if (empty) return { type: empty[1], message: "" };
  const colon = COLON.exec(firstLine);
  if (colon) return { type: colon[1], message: colon[2] };
  return { type: "", message: firstLine };
}

export function fingerprint(raw: string): ExceptionFingerprint {
  const { type, message } = splitException(raw);

  let template = message;
  for (const [re, sub] of RULES) {
    template = template.replace(re, sub as string);
  }

  const parts: MessagePart[] = [];
  const re = /\{([a-z0-9_]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index) });
    parts.push({ param: m[1] });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });

  return { type, template, parts, key: `${type}\u0001${template}` };
}

export type MergedFailureGroup = {
  fingerprint: ExceptionFingerprint;
  count: number;
  first_seen: number;
  last_seen: number;
  task_names: string[];
  latest_task_id: string;
  /// The newest raw exception text, for tooltips.
  example: string;
  /// Traceback of the newest occurrence.
  traceback: string;
  /// Up to three distinct raw messages folded into the group, newest first.
  samples: string[];
  /// How many distinct raw messages were folded into this group.
  variants: number;
};

/// Folds exception groups whose messages differ only by IDs, URLs or other
/// volatile values into one row per fingerprint.
export function mergeFailureGroups(rows: FailureGroupRow[]): MergedFailureGroup[] {
  const byKey = new Map<string, MergedFailureGroup>();
  for (const row of rows) {
    const fp = fingerprint(row.exception);
    const cur = byKey.get(fp.key);
    if (!cur) {
      byKey.set(fp.key, {
        fingerprint: fp,
        count: row.count,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        task_names: [...row.task_names],
        latest_task_id: row.latest_task_id,
        example: row.exception,
        traceback: row.latest_traceback,
        samples: [row.exception],
        variants: 1,
      });
      continue;
    }
    cur.count += row.count;
    cur.variants += 1;
    cur.first_seen = Math.min(cur.first_seen, row.first_seen);
    if (row.last_seen > cur.last_seen) {
      cur.last_seen = row.last_seen;
      cur.latest_task_id = row.latest_task_id;
      cur.example = row.exception;
      cur.traceback = row.latest_traceback;
      cur.samples.unshift(row.exception);
    } else {
      cur.samples.push(row.exception);
    }
    if (cur.samples.length > 3) cur.samples.length = 3;
    for (const n of row.task_names) if (!cur.task_names.includes(n)) cur.task_names.push(n);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || b.last_seen - a.last_seen);
}
