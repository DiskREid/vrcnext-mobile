import { describe, expect, it } from 'vitest';
import { userPlatformInfo } from './user-platform';

describe('user platform icons from API evidence', () => {
  it('identifies documented client platforms and keeps their original values', () => {
    expect(userPlatformInfo('standalonewindows')).toEqual({
      id: 'pc',
      label: 'ПК',
      raw: 'standalonewindows',
    });
    expect(userPlatformInfo('android')).toMatchObject({ id: 'android', label: 'Android' });
    expect(userPlatformInfo('ios')).toMatchObject({ id: 'ios', label: 'iOS' });
    expect(userPlatformInfo('web')).toMatchObject({ id: 'web', label: 'Сайт' });
    expect(userPlatformInfo('  IOS  ')).toEqual({ id: 'ios', label: 'iOS', raw: 'IOS' });
  });
  it('never assumes that PC or Android means VR mode', () => {
    expect(userPlatformInfo('standalonewindows')?.id).not.toBe('vr');
    expect(userPlatformInfo('android')?.id).not.toBe('vr');
    expect(userPlatformInfo({ platform: 'android', isVR: true })).toBeUndefined();
    expect(userPlatformInfo('vr')).toMatchObject({ id: 'vr', label: 'VR' });
  });
  it('does not turn missing or unexpected values into a claimed platform', () => {
    for (const value of [null, undefined, '', '  ', 0, false, [], {}])
      expect(userPlatformInfo(value)).toBeUndefined();
    for (const value of [
      'unknownplatform',
      '2019.2.4-801-Release',
      'pcvr',
      'quest',
      '<script>',
      '__proto__',
      'constructor',
    ]) {
      expect(userPlatformInfo(value)).toEqual({
        id: 'unknown',
        label: 'Платформа неизвестна',
        raw: value,
      });
    }
  });
});
