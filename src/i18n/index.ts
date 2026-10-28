import { useSyncExternalStore } from 'react';
import core from './messages/core';
import explore from './messages/explore';
import social from './messages/social';
import components from './messages/components';
import personal from './messages/personal';
import about from './messages/about';
import ja from './locales/ja.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import pl from './locales/pl.json';
import it from './locales/it.json';
import tr from './locales/tr.json';
import uk from './locales/uk.json';
import { activityMessages } from './activity-messages';

export const SUPPORTED_LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'pl', label: 'Polski' },
  { code: 'it', label: 'Italiano' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'uk', label: 'Українська' },
] as const;
export type Locale = (typeof SUPPORTED_LANGUAGES)[number]['code'];
export type Language = 'system' | Locale;
export const LANGUAGE_STORAGE_KEY = 'vrcnext.language';
export const englishMessages: Record<string, string> = {
  ...core,
  ...explore,
  ...social,
  ...components,
  ...personal,
  ...about,
  ...Object.fromEntries(activityMessages.map((item) => [item.source, item.en])),
};
export const localePacks: Partial<Record<Locale, Record<string, string>>> = {
  ja,
  de,
  fr,
  es,
  pt,
  pl,
  it,
  tr,
  uk,
};
const normalize = (source: string) => source.replace(/\s+/g, ' ').trim();
/** Stable source IDs keep language packs independent of catalog ordering. */
export function messageId(source: string): string {
  const value = normalize(source);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
for (const { code } of SUPPORTED_LANGUAGES) {
  if (code === 'ru' || code === 'en') continue;
  Object.assign(
    localePacks[code]!,
    Object.fromEntries(activityMessages.map((item) => [messageId(item.source), item[code]])),
  );
}
const english = new Map(
  Object.entries(englishMessages).map(([key, value]) => [
    normalize(key),
    { text: value.trim(), id: messageId(key) },
  ]),
);
/** Application messages retain their source key while stored in local activity. */
export type UiMessage = { key: string; params?: Record<string, string | number> };
export const uiMessage = (key: string, params?: Record<string, string | number>): UiMessage => ({
  key,
  params,
});
const isLocale = (value: string): value is Locale =>
  SUPPORTED_LANGUAGES.some((item) => item.code === value);
export function resolveLocale(
  preference: Language,
  systemLanguages: readonly string[] = [],
): Locale {
  if (preference !== 'system') return preference;
  for (const value of systemLanguages) {
    const code = value.toLowerCase().split(/[-_]/)[0];
    if (isLocale(code)) return code;
  }
  return 'en';
}
export function readLanguage(storage?: Pick<Storage, 'getItem'>): Language {
  try {
    const value = (
      storage || (typeof localStorage !== 'undefined' ? localStorage : undefined)
    )?.getItem(LANGUAGE_STORAGE_KEY);
    return value && isLocale(value) ? value : 'system';
  } catch {
    return 'system';
  }
}
let language: Language = readLanguage();
const systemLanguages = () =>
  typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
let locale = resolveLocale(language, systemLanguages());
const listeners = new Set<() => void>();
const snapshot = () => `${language}:${locale}`;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function applyDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
applyDocumentLanguage();
export function setLanguage(value: Language) {
  if (value !== 'system' && !isLocale(value)) return;
  language = value;
  locale = resolveLocale(language, systemLanguages());
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    /* Apply for this session if storage is unavailable. */
  }
  applyDocumentLanguage();
  for (const listener of listeners) listener();
}
if (typeof window !== 'undefined')
  window.addEventListener('languagechange', () => {
    if (language !== 'system') return;
    locale = resolveLocale(language, systemLanguages());
    applyDocumentLanguage();
    for (const listener of listeners) listener();
  });
export function translate(
  source: string,
  target: Locale,
  params?: Record<string, string | number>,
): string {
  const entry = english.get(normalize(source));
  let message = target === 'ru' || !entry ? source : localePacks[target]?.[entry.id] || entry.text;
  if (target !== 'ru' && entry && !/[\n\r]/.test(source)) {
    message = `${source.startsWith(' ') ? ' ' : ''}${message.trim()}${source.endsWith(' ') ? ' ' : ''}`;
  }
  return params
    ? message.replace(/\{(\w+)\}/g, (match, key: string) =>
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
      )
    : message;
}
/** Translate app copy only. Names, biographies, worlds and other user content remain original. */
export function t(source: string, params?: Record<string, string | number>): string {
  return translate(source, locale, params);
}
const intlLocales: Record<Locale, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  ja: 'ja-JP',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-BR',
  pl: 'pl-PL',
  it: 'it-IT',
  tr: 'tr-TR',
  uk: 'uk-UA',
};
export const dateLocale = () => intlLocales[locale];
export function useI18n() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { language, locale, setLanguage, t, dateLocale };
}
