import { describe, expect, it } from 'vitest';
import { diffText } from './text-diff';
import type { TextDiffPart } from './text-diff';

const oldText = (parts: TextDiffPart[]) =>
  parts
    .filter((part) => part.kind !== 'insert')
    .map((part) => part.text)
    .join('');
const newText = (parts: TextDiffPart[]) =>
  parts
    .filter((part) => part.kind !== 'delete')
    .map((part) => part.text)
    .join('');

describe('Bio text differences', () => {
  it('preserves unchanged Cyrillic words and refines a changed time without repeating the whole Bio', () => {
    const before = 'Привет, друзья! Встречаемся в 22:22.';
    const after = 'Привет, друзья! Встречаемся в 22:23.';
    const parts = diffText(before, after);
    expect(oldText(parts)).toBe(before);
    expect(newText(parts)).toBe(after);
    expect(parts.filter((part) => part.kind === 'delete')).toEqual([{ kind: 'delete', text: '2' }]);
    expect(parts.filter((part) => part.kind === 'insert')).toEqual([{ kind: 'insert', text: '3' }]);
  });
  it('shows separate changes while retaining unchanged words, spaces and newlines', () => {
    const before = 'Люблю VRChat\nМои друзья рядом.\nDiscord: old_name';
    const after = 'Люблю танцы\nМои друзья рядом.\nDiscord: new_name';
    const parts = diffText(before, after);
    expect(oldText(parts)).toBe(before);
    expect(newText(parts)).toBe(after);
    expect(
      parts.some((part) => part.kind === 'equal' && part.text.includes('Мои друзья рядом.')),
    ).toBe(true);
    expect(
      parts
        .filter((part) => part.kind === 'delete')
        .map((part) => part.text)
        .join(''),
    ).toContain('VRChat');
    expect(
      parts
        .filter((part) => part.kind === 'insert')
        .map((part) => part.text)
        .join(''),
    ).toContain('танцы');
  });
  it('records clearing and adding a Bio without silently dropping empty values', () => {
    expect(diffText('Было описание', '')).toEqual([{ kind: 'delete', text: 'Было описание' }]);
    expect(diffText('', 'Новое описание')).toEqual([{ kind: 'insert', text: 'Новое описание' }]);
    expect(diffText('', '')).toEqual([]);
    expect(diffText('без изменений', 'без изменений')).toEqual([
      { kind: 'equal', text: 'без изменений' },
    ]);
  });
  it('never splits family emoji, skin tones, flags or combining characters into colored fragments', () => {
    for (const [before, after] of [
      ['Семья 👨‍👩‍👧‍👦', 'Семья 👩‍👩‍👧‍👦'],
      ['Привет 👋🏽', 'Привет 👋🏻'],
      ['Я 🇺🇦', 'Я 🇵🇱'],
      ['Имя е\u0301', 'Имя е\u0300'],
    ]) {
      const parts = diffText(before, after);
      expect(oldText(parts)).toBe(before);
      expect(newText(parts)).toBe(after);
      const removed = parts.find((part) => part.kind === 'delete')!.text;
      const inserted = parts.find((part) => part.kind === 'insert')!.text;
      const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
      expect([...segmenter.segment(removed)].length).toBe(1);
      expect([...segmenter.segment(inserted)].length).toBe(1);
    }
  });
  it('keeps HTML-like content as literal text and reconstructs long adversarial Bios compactly', () => {
    const literal = diffText('<script>alert(1)</script>', '<img src=x onerror=alert(2)>');
    expect(oldText(literal)).toBe('<script>alert(1)</script>');
    expect(newText(literal)).toBe('<img src=x onerror=alert(2)>');
    const before = 'я '.repeat(4096),
      after = 'ты!'.repeat(2730);
    const large = diffText(before, after);
    expect(oldText(large)).toBe(before);
    expect(newText(large)).toBe(after);
    expect(large.length).toBeLessThanOrEqual(4);
  });
});
