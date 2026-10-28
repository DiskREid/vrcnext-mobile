import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  uiMessage,
  dateLocale,
  englishMessages,
  LANGUAGE_STORAGE_KEY,
  localePacks,
  messageId,
  readLanguage,
  resolveLocale,
  setLanguage,
  SUPPORTED_LANGUAGES,
  t,
  translate,
} from './index';
import type { Locale } from './index';

const codes = ['ru', 'en', 'ja', 'de', 'fr', 'es', 'pt', 'pl', 'it', 'tr', 'uk'] as const;
const storage = (value: string | null) => ({
  getItem: (key: string) => (key === LANGUAGE_STORAGE_KEY ? value : null),
});
afterEach(() => {
  setLanguage('system');
  vi.unstubAllGlobals();
});

describe('device language and stored preference', () => {
  it('offers each requested language once, using recognizable native names', () => {
    expect(SUPPORTED_LANGUAGES.map((item) => item.code)).toEqual(codes);
    expect(new Set(SUPPORTED_LANGUAGES.map((item) => item.code)).size).toBe(11);
    expect(SUPPORTED_LANGUAGES.every((item) => item.label.trim().length > 0)).toBe(true);
  });
  it('matches regional variants without replacing an explicit preference', () => {
    for (const code of codes) {
      expect(resolveLocale('system', [`${code}-XX`])).toBe(code);
      expect(resolveLocale(code, ['de-DE'])).toBe(code);
    }
    expect(resolveLocale('system', ['zh-CN', 'fr-CA', 'en-US'])).toBe('fr');
    expect(resolveLocale('system', ['xx-ZZ'])).toBe('en');
    expect(resolveLocale('system', [])).toBe('en');
  });
  it('loads all valid saved preferences and safely ignores corrupt or inaccessible storage', () => {
    for (const code of [...codes, 'system']) expect(readLanguage(storage(code))).toBe(code);
    for (const value of [null, '', 'RU', 'zh', '{"locale":"en"}', '<script>'])
      expect(readLanguage(storage(value))).toBe('system');
    expect(
      readLanguage({
        getItem: () => {
          throw new Error('Storage denied');
        },
      }),
    ).toBe('system');
  });
  it('saves language independently without touching session or local history data', () => {
    const values = new Map([
      ['history-account', 'preserved'],
      ['session-marker', 'preserved'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    for (const code of codes) {
      setLanguage(code);
      expect(values.get(LANGUAGE_STORAGE_KEY)).toBe(code);
      expect(dateLocale().toLowerCase().split('-')[0]).toBe(code);
    }
    expect(values.get('history-account')).toBe('preserved');
    expect(values.get('session-marker')).toBe('preserved');
    expect(values.size).toBe(3);
  });
  it('applies a selection for this session even when saving is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('Storage full');
      },
    });
    expect(() => setLanguage('ja')).not.toThrow();
    expect(dateLocale()).toMatch(/^ja/i);
    expect(t('Настройки')).toMatch(/設定/);
  });
});

describe('application messages and interpolated original content', () => {
  it('stores application action titles canonically so a later language switch can translate them again', () => {
    for (const code of codes) {
      setLanguage(code);
      const title = uiMessage('Вход в аккаунт');
      expect(title.key).toBe('Вход в аккаунт');
      setLanguage('ja');
      expect(t(title.key, title.params)).toMatch(/ログイン/);
      setLanguage('ru');
      expect(t(title.key, title.params)).toBe('Вход в аккаунт');
    }
    const original = 'Custom player message: 世界 <b>Настройки</b>';
    const message = uiMessage('Profile: {name}', { name: original });
    expect(translate(message.key, 'ja', message.params)).toBe(`Profile: ${original}`);
  });
  it('ships complete built-in packs with stable IDs and the same placeholders as the source catalog', () => {
    const messages = new Map(
      Object.entries(englishMessages).map(([source, english]) => [
        source.replace(/\s+/g, ' ').trim(),
        english.trim(),
      ]),
    );
    const expected = [...messages.keys()].map(messageId).sort();
    expect(new Set(expected).size).toBe(messages.size);
    expect(Object.keys(localePacks).sort()).toEqual(
      codes.filter((code) => code !== 'ru' && code !== 'en').sort(),
    );
    const parameters = (value: string) =>
      Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
    for (const [code, pack] of Object.entries(localePacks)) {
      expect(Object.keys(pack).sort(), `${code} message coverage`).toEqual(expected);
      for (const [source, english] of messages) {
        const translated = pack[messageId(source)];
        expect(translated.trim().length, `${code}: ${source}`).toBeGreaterThan(0);
        expect(parameters(translated), `${code}: ${source}`).toEqual(parameters(english));
        expect(translate(source, code as Locale).trim(), `${code}: ${source}`).toBe(
          translated.trim(),
        );
      }
    }
  });
  it('translates a primary setting into every requested language', () => {
    const expected: Record<Locale, RegExp> = {
      ru: /^Настройки$/,
      en: /^Settings$/,
      ja: /設定/,
      de: /Einstellungen/,
      fr: /Paramètres/,
      es: /Configuración|Ajustes/,
      pt: /Configurações|Definições/,
      pl: /Ustawienia/,
      it: /Impostazioni/,
      tr: /Ayarlar/,
      uk: /Налаштування/,
    };
    for (const code of codes) expect(translate('Настройки', code)).toMatch(expected[code]);
  });
  it('normalizes message whitespace for lookup and preserves unknown content verbatim', () => {
    expect(translate('  Настройки \n ', 'en')).toBe('Settings');
    const original = '  Unknown player biography\n世界 <img src=x onerror=alert(1)>  ';
    for (const code of codes) expect(translate(original, code)).toBe(original);
  });
  it('interpolates values once without treating user data as further messages or markup', () => {
    const original = 'Настройки {name} <b>世界</b>';
    for (const code of codes) {
      expect(translate('Profile: {name}', code, { name: original })).toBe(`Profile: ${original}`);
      expect(translate('Count: {count}, missing: {missing}', code, { count: 0 })).toBe(
        'Count: 0, missing: {missing}',
      );
    }
  });
  it('keeps color values and all template placeholders available across languages', () => {
    for (const code of codes) {
      const translated = translate('Цвет {color}', code, { color: '#a398ff' });
      expect(translated).toContain('#a398ff');
      expect(translated).not.toContain('{color}');
    }
  });
});
