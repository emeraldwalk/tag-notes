import type { ParsedNote } from './types';

/**
 * Parses raw note text into a title, body, and tags.
 *
 * Format:
 * ```text
 * some title
 *
 * body of note
 *
 * potential multi-lines, etc.
 *
 * :tag 1, tag 2, tag-three
 * ```
 *
 * - The title is the first non-empty (non-whitespace-only) line, trimmed.
 * - If the last line of the text (trimmed of surrounding whitespace) starts
 *   with `:`, it is treated as a tag line: everything after the leading `:`
 *   is split on `,`, each segment trimmed of surrounding whitespace,
 *   lowercased, empty segments discarded, and duplicates removed
 *   (first-seen order preserved).
 * - The body is everything between the title line and the tag line (if any),
 *   trimmed of leading/trailing blank lines/whitespace as a whole block,
 *   with internal formatting preserved.
 */
export function parseNoteText(rawText: string): ParsedNote {
  const lines = rawText.split('\n');

  const titleIndex = lines.findIndex((line) => line.trim() !== '');

  if (titleIndex === -1) {
    return { title: '', body: '', tags: [] };
  }

  const title = lines[titleIndex].trim();

  // Ignore trailing blank lines when looking for the tag line, so trailing
  // newlines after the tag line (or trailing blank lines with no tag line)
  // don't prevent detection.
  let lastContentIndex = lines.length - 1;
  while (lastContentIndex > titleIndex && lines[lastContentIndex].trim() === '') {
    lastContentIndex--;
  }

  let endIndex = lines.length; // exclusive
  let tags: string[] = [];

  const trimmedLastContentLine = lines[lastContentIndex].trim();

  if (trimmedLastContentLine.startsWith(':') && lastContentIndex > titleIndex) {
    tags = parseTags(trimmedLastContentLine.slice(1));
    endIndex = lastContentIndex;
  }

  const bodyLines = lines.slice(titleIndex + 1, endIndex);
  const body = bodyLines.join('\n').trim();

  return { title, body, tags };
}

/**
 * Builds rawText in the format `parseNoteText` expects, from separate
 * title/body/tags fields. Round-trips: `parseNoteText(serializeNote(t, b, tags))`
 * reproduces `{ title: t.trim(), body: b.trim(), tags: parseTags(tags.join(',')) }`.
 */
export function serializeNote(title: string, body: string, tags: string[]): string {
  const parts = [title.trim()];

  const trimmedBody = body.trim();
  if (trimmedBody !== '') {
    parts.push(trimmedBody);
  }

  const cleanTags = parseTags(tags.join(','));
  if (cleanTags.length > 0) {
    parts.push(`:${cleanTags.join(', ')}`);
  }

  return parts.join('\n\n');
}

export function parseTags(rawTagSegment: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const segment of rawTagSegment.split(',')) {
    const tag = segment.trim().toLowerCase();
    if (tag === '') continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }

  return tags;
}
