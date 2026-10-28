import type { Locale } from '../i18n';

type Copy = Record<Locale, string>;
const names: Record<string, Copy> = {
  early: {
    ru: 'Ранняя поддержка',
    en: 'Early Supporter',
    ja: '初期サポーター',
    de: 'Unterstützer der ersten Stunde',
    fr: 'Soutien de la première heure',
    es: 'Colaborador inicial',
    pt: 'Apoiador inicial',
    pl: 'Wczesny wspierający',
    it: 'Sostenitore iniziale',
    tr: 'İlk destekçilerden',
    uk: 'Рання підтримка',
  },
  supporter: {
    ru: 'Поддержка VRChat',
    en: 'VRChat Supporter',
    ja: 'VRChatサポーター',
    de: 'VRChat-Unterstützer',
    fr: 'Soutien de VRChat',
    es: 'Colaborador de VRChat',
    pt: 'Apoiador do VRChat',
    pl: 'Wspierający VRChat',
    it: 'Sostenitore di VRChat',
    tr: 'VRChat destekçisi',
    uk: 'Підтримка VRChat',
  },
  plus: {
    ru: 'Поддержка VRC+',
    en: 'VRC+ Supporter',
    ja: 'VRC+サポーター',
    de: 'VRC+-Unterstützer',
    fr: 'Soutien de VRC+',
    es: 'Colaborador de VRC+',
    pt: 'Apoiador do VRC+',
    pl: 'Wspierający VRC+',
    it: 'Sostenitore di VRC+',
    tr: 'VRC+ destekçisi',
    uk: 'Підтримка VRC+',
  },
  subscriber: {
    ru: 'Подписчик VRC+',
    en: 'VRC+ Subscriber',
    ja: 'VRC+加入者',
    de: 'VRC+-Abonnent',
    fr: 'Abonné VRC+',
    es: 'Suscriptor de VRC+',
    pt: 'Assinante do VRC+',
    pl: 'Subskrybent VRC+',
    it: 'Abbonato VRC+',
    tr: 'VRC+ abonesi',
    uk: 'Підписник VRC+',
  },
  giver: {
    ru: 'Даритель подарков',
    en: 'Gift Giver',
    ja: 'ギフト贈呈者',
    de: 'Geschenkgeber',
    fr: 'Donateur de cadeaux',
    es: 'Donante de regalos',
    pt: 'Doador de presentes',
    pl: 'Darczyńca prezentów',
    it: 'Donatore di regali',
    tr: 'Hediye veren',
    uk: 'Дарувальник подарунків',
  },
  plusGiver: {
    ru: 'Даритель VRC+',
    en: 'VRC+ Gift Giver',
    ja: 'VRC+ギフト贈呈者',
    de: 'VRC+-Geschenkgeber',
    fr: 'Donateur de VRC+',
    es: 'Donante de VRC+',
    pt: 'Doador de VRC+',
    pl: 'Darczyńca VRC+',
    it: 'Donatore di VRC+',
    tr: 'VRC+ hediye eden',
    uk: 'Дарувальник VRC+',
  },
  team: {
    ru: 'Команда VRChat',
    en: 'VRChat Team',
    ja: 'VRChatチーム',
    de: 'VRChat-Team',
    fr: 'Équipe VRChat',
    es: 'Equipo de VRChat',
    pt: 'Equipe do VRChat',
    pl: 'Zespół VRChat',
    it: 'Team di VRChat',
    tr: 'VRChat ekibi',
    uk: 'Команда VRChat',
  },
  creator: {
    ru: 'Автор контента VRChat',
    en: 'VRChat Creator',
    ja: 'VRChatクリエイター',
    de: 'VRChat-Creator',
    fr: 'Créateur VRChat',
    es: 'Creador en VRChat',
    pt: 'Criador de conteúdo VRChat',
    pl: 'Twórca treści VRChat',
    it: 'Creatore di contenuti VRChat',
    tr: 'VRChat içerik üreticisi',
    uk: 'Автор контенту VRChat',
  },
  translator: {
    ru: 'Переводчик VRChat',
    en: 'VRChat Translator',
    ja: 'VRChat翻訳貢献者',
    de: 'VRChat-Übersetzer',
    fr: 'Traducteur VRChat',
    es: 'Traductor de VRChat',
    pt: 'Tradutor do VRChat',
    pl: 'Tłumacz VRChat',
    it: 'Traduttore VRChat',
    tr: 'VRChat çevirmeni',
    uk: 'Перекладач VRChat',
  },
  contributor: {
    ru: 'Участник сообщества',
    en: 'Community Contributor',
    ja: 'コミュニティ貢献者',
    de: 'Mitwirkender der Community',
    fr: 'Contributeur de la communauté',
    es: 'Colaborador de la comunidad',
    pt: 'Colaborador da comunidade',
    pl: 'Współtwórca społeczności',
    it: 'Collaboratore della community',
    tr: 'Topluluğa katkıda bulunan',
    uk: 'Учасник спільноти',
  },
};
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const aliases = new Map<string, string>();
for (const [key, variants] of Object.entries({
  early: ['Early Supporter', 'VRChat Early Supporter'],
  supporter: ['Supporter', 'VRChat Supporter'],
  plus: ['VRC+ Supporter', 'VRChat+ Supporter', 'VRChat Plus Supporter'],
  subscriber: ['VRC+ Subscriber', 'VRChat+ Subscriber', 'VRChat Plus Subscriber'],
  giver: ['Gift Giver', 'Giftgiver', 'Gifter', 'Gift Giver Badge'],
  plusGiver: [
    'VRC+ Gift Giver',
    'VRC+ Giftgiver',
    'VRC+ Gifter',
    'VRChat+ Gift Giver',
    'VRChat+ Gifter',
    'VRChat Plus Gift Giver',
    'VRChat Plus Gifter',
  ],
  team: ['VRChat Team', 'VRChat Staff'],
  creator: ['Creator', 'VRChat Creator'],
  translator: ['Translator', 'VRChat Translator', 'Localization Contributor'],
  contributor: ['Community Contributor'],
}))
  for (const variant of variants) aliases.set(normalize(variant), key);

const thanks: Copy = {
  ru: 'Спасибо за вашу поддержку!',
  en: 'Thank you for your support!',
  ja: 'ご支援ありがとうございます！',
  de: 'Vielen Dank für deine Unterstützung!',
  fr: 'Merci pour votre soutien !',
  es: '¡Gracias por tu apoyo!',
  pt: 'Obrigado pelo seu apoio!',
  pl: 'Dziękujemy za wsparcie!',
  it: 'Grazie per il tuo sostegno!',
  tr: 'Desteğin için teşekkürler!',
  uk: 'Дякуємо за вашу підтримку!',
};
const thanksVrchat: Copy = {
  ru: 'Спасибо за поддержку VRChat!',
  en: 'Thank you for supporting VRChat!',
  ja: 'VRChatをご支援いただきありがとうございます！',
  de: 'Vielen Dank, dass du VRChat unterstützt!',
  fr: 'Merci de soutenir VRChat !',
  es: '¡Gracias por apoyar a VRChat!',
  pt: 'Obrigado por apoiar o VRChat!',
  pl: 'Dziękujemy za wspieranie VRChat!',
  it: 'Grazie per il tuo sostegno a VRChat!',
  tr: 'VRChat’i desteklediğin için teşekkürler!',
  uk: 'Дякуємо за підтримку VRChat!',
};
const thanksEarly: Copy = {
  ru: 'Спасибо, что поддержали VRChat на раннем этапе!',
  en: 'Thank you for being an early supporter of VRChat!',
  ja: 'VRChatを初期から支えていただきありがとうございます！',
  de: 'Danke, dass du VRChat von Anfang an unterstützt hast!',
  fr: 'Merci d’avoir soutenu VRChat dès ses débuts !',
  es: '¡Gracias por apoyar a VRChat desde sus inicios!',
  pt: 'Obrigado por apoiar o VRChat desde o início!',
  pl: 'Dziękujemy za wspieranie VRChat od początku!',
  it: 'Grazie per aver sostenuto VRChat fin dall’inizio!',
  tr: 'VRChat’i ilk günlerinden beri desteklediğin için teşekkürler!',
  uk: 'Дякуємо, що підтримали VRChat на ранньому етапі!',
};
const descriptions = new Map<string, Copy>(
  [thanks, thanksVrchat, thanksEarly].map((copy) => [normalize(copy.en), copy]),
);
const recap: Copy = {
  ru: 'Итоги VRChat {year}',
  en: 'VRChat Recap {year}',
  ja: 'VRChat {year}年の振り返り',
  de: 'VRChat-Jahresrückblick {year}',
  fr: 'Rétrospective VRChat {year}',
  es: 'Resumen de VRChat {year}',
  pt: 'Retrospectiva VRChat {year}',
  pl: 'Podsumowanie VRChat {year}',
  it: 'Riepilogo VRChat {year}',
  tr: 'VRChat {year} özeti',
  uk: 'Підсумки VRChat {year}',
};

/** Exact badge copy only. Unknown/new award text and arbitrary profile content stay original. */
export function profileBadgeCopy(
  badge: Record<string, unknown>,
  locale: Locale,
): { name: string; description: string } {
  const string = (value: unknown) => (typeof value === 'string' ? value : '');
  const name = string(badge.badgeName) || string(badge.name);
  const description = string(badge.badgeDescription) || string(badge.description);
  // English is the authoritative API text, including spelling, counts and wording.
  if (locale === 'en') return { name, description };
  const key = aliases.get(normalize(name));
  const year = /^(?:VRChat Recap (20\d{2})|(20\d{2}) VRChat Recap|VRChat (20\d{2}) Recap)$/i.exec(
    name.trim(),
  );
  return {
    name: key
      ? names[key][locale]
      : year
        ? recap[locale].replace('{year}', year[1] || year[2] || year[3])
        : name,
    description: descriptions.get(normalize(description))?.[locale] || description,
  };
}
