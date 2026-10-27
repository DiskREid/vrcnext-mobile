export type TextDiffPart = { kind: 'equal' | 'delete' | 'insert'; text: string };

const wordSegments = new Intl.Segmenter('ru', { granularity: 'word' });
const graphemeSegments = new Intl.Segmenter('ru', { granularity: 'grapheme' });
// A long or heavily changed Bio falls back to a linear comparison, never an
// unbounded quadratic matrix or thousands of individually rendered characters.
const maxCells = 250_000;

function segments(value: string, segmenter: Intl.Segmenter): string[] {
  return Array.from(segmenter.segment(value), (part) => part.segment);
}

function append(parts: TextDiffPart[], kind: TextDiffPart['kind'], text: string) {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.kind === kind) last.text += text;
  else parts.push({ kind, text });
}

/** Preserve whole emoji/combining characters when refining the edge of a replacement. */
function replace(before: string, after: string): TextDiffPart[] {
  const old = segments(before, graphemeSegments),
    fresh = segments(after, graphemeSegments);
  let prefix = 0,
    suffix = 0;
  while (prefix < old.length && prefix < fresh.length && old[prefix] === fresh[prefix]) prefix++;
  while (
    suffix < old.length - prefix &&
    suffix < fresh.length - prefix &&
    old[old.length - suffix - 1] === fresh[fresh.length - suffix - 1]
  )
    suffix++;
  const parts: TextDiffPart[] = [];
  append(parts, 'equal', old.slice(0, prefix).join(''));
  append(parts, 'delete', old.slice(prefix, old.length - suffix).join(''));
  append(parts, 'insert', fresh.slice(prefix, fresh.length - suffix).join(''));
  append(parts, 'equal', suffix ? old.slice(old.length - suffix).join('') : '');
  return parts;
}

/** Exact text reconstruction with bounded work; input is never interpreted as HTML. */
export function diffText(before: string, after: string): TextDiffPart[] {
  if (before === after) return before ? [{ kind: 'equal', text: before }] : [];
  if (!before) return [{ kind: 'insert', text: after }];
  if (!after) return [{ kind: 'delete', text: before }];
  const old = segments(before, wordSegments),
    fresh = segments(after, wordSegments);
  const columns = fresh.length + 1;
  if ((old.length + 1) * columns > maxCells) return replace(before, after);
  const common = new Uint16Array((old.length + 1) * columns);
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = fresh.length - 1; j >= 0; j--) {
      common[i * columns + j] =
        old[i] === fresh[j]
          ? common[(i + 1) * columns + j + 1] + 1
          : Math.max(common[(i + 1) * columns + j], common[i * columns + j + 1]);
    }
  }
  const wordParts: TextDiffPart[] = [];
  let i = 0,
    j = 0;
  while (i < old.length || j < fresh.length) {
    if (i < old.length && j < fresh.length && old[i] === fresh[j]) {
      append(wordParts, 'equal', old[i]);
      i++;
      j++;
    } else if (
      i < old.length &&
      (j === fresh.length || common[(i + 1) * columns + j] >= common[i * columns + j + 1])
    ) {
      append(wordParts, 'delete', old[i++]);
    } else append(wordParts, 'insert', fresh[j++]);
  }
  const result: TextDiffPart[] = [];
  for (let index = 0; index < wordParts.length; ) {
    const part = wordParts[index];
    if (part.kind === 'equal') {
      append(result, 'equal', part.text);
      index++;
      continue;
    }
    let removed = '',
      added = '';
    while (index < wordParts.length && wordParts[index].kind !== 'equal') {
      const change = wordParts[index++];
      if (change.kind === 'delete') removed += change.text;
      else added += change.text;
    }
    for (const change of replace(removed, added)) append(result, change.kind, change.text);
  }
  return result;
}
