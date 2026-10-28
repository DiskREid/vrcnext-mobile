import { describe, expect, it } from 'vitest';
import { profileBadgeCopy } from './profile-badges';
import { SUPPORTED_LANGUAGES } from '../i18n';

describe('official badge text localization without changing profile data', () => {
  it('recognizes exact standard names and aliases independently of UI message keys', () => {
    expect(profileBadgeCopy({ badgeName: 'Early Supporter' }, 'ru').name).toBe('Ранняя поддержка');
    expect(profileBadgeCopy({ badgeName: '  vrchat   early supporter  ' }, 'ja').name).toBe(
      '初期サポーター',
    );
    expect(profileBadgeCopy({ name: 'VRChat Plus Supporter' }, 'de').name).toBe(
      'VRC+-Unterstützer',
    );
    expect(profileBadgeCopy({ badgeName: 'VRC+ Gifter' }, 'ru').name).toBe('Даритель VRC+');
    expect(profileBadgeCopy({ badgeName: 'VRChat Creator' }, 'uk').name).toBe(
      'Автор контенту VRChat',
    );
  });
  it('keeps unknown titles, counts and descriptions verbatim rather than guessing from a known name or ID', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(
        profileBadgeCopy(
          {
            badgeId: 'bdg_98b3f9e6-ab5e-4133-96c1-70cb06c07500',
            badgeName: 'Настройки',
            badgeDescription: 'Миры',
          },
          code,
        ),
      ).toEqual({ name: 'Настройки', description: 'Миры' });
      expect(
        profileBadgeCopy(
          { badgeName: 'VRC+ Supporter', badgeDescription: 'Awarded after 37 gifts; tier 4.' },
          code,
        ).description,
      ).toBe('Awarded after 37 gifts; tier 4.');
      expect(profileBadgeCopy({ badgeName: 'Early Supporter 37' }, code).name).toBe(
        'Early Supporter 37',
      );
    }
  });
  it('translates only recognized full description text and preserves original English spelling', () => {
    const badge = { badgeName: 'VRC+ Supporter', badgeDescription: 'Thank you for your support!' };
    expect(profileBadgeCopy(badge, 'ru').description).toBe('Спасибо за вашу поддержку!');
    expect(
      profileBadgeCopy({ ...badge, badgeDescription: 'Thank you for your support! Tier 5.' }, 'ru')
        .description,
    ).toBe('Thank you for your support! Tier 5.');
    expect(
      profileBadgeCopy(
        {
          badgeName: 'VRChat Plus Supporter',
          badgeDescription: 'Thank you for supporting VRChat!',
        },
        'en',
      ),
    ).toEqual({ name: 'VRChat Plus Supporter', description: 'Thank you for supporting VRChat!' });
  });
  it('provides badge names and known descriptions for every supported locale', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      const copy = profileBadgeCopy(
        { badgeName: 'Early Supporter', badgeDescription: 'Thank you for your support!' },
        code,
      );
      expect(copy.name.trim()).not.toBe('');
      expect(copy.description.trim()).not.toBe('');
      if (code !== 'en') {
        expect(copy.name).not.toBe('Early Supporter');
        expect(copy.description).not.toBe('Thank you for your support!');
      }
    }
  });
  it('preserves the disclosed year only for anchored recap name patterns', () => {
    expect(profileBadgeCopy({ badgeName: '2025 VRChat Recap' }, 'ru').name).toBe(
      'Итоги VRChat 2025',
    );
    expect(profileBadgeCopy({ badgeName: 'VRChat 2026 Recap' }, 'ja').name).toBe(
      'VRChat 2026年の振り返り',
    );
    expect(profileBadgeCopy({ badgeName: 'Custom VRChat Recap 2026' }, 'ru').name).toBe(
      'Custom VRChat Recap 2026',
    );
  });
  it('does not mutate badge objects, image URLs, hidden flags or raw JSON export values', () => {
    const badge = Object.freeze({
      badgeId: 'bdg_fixture',
      badgeName: 'Early Supporter',
      badgeDescription: 'Thank you for your support!',
      badgeImageUrl: 'https://api.vrchat.cloud/api/1/file/file_sample/1',
      hidden: true,
    });
    const before = JSON.stringify(badge);
    profileBadgeCopy(badge, 'ja');
    profileBadgeCopy(badge, 'ru');
    expect(JSON.stringify(badge)).toBe(before);
    expect(profileBadgeCopy({ badgeName: 3, badgeDescription: null }, 'ru')).toEqual({
      name: '',
      description: '',
    });
  });
});
