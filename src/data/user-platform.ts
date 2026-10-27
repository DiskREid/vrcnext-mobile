export type UserPlatform = 'pc' | 'android' | 'ios' | 'vr' | 'web' | 'unknown';
export type UserPlatformInfo = { id: UserPlatform; label: string; raw: string };

/** A platform identifies the client build, not whether its user is wearing a headset. */
export function userPlatformInfo(value: unknown): UserPlatformInfo | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  const raw = value.trim();
  const platform = raw.toLowerCase();
  const known: Record<string, { id: UserPlatform; label: string }> = {
    standalonewindows: { id: 'pc', label: 'ПК' },
    android: { id: 'android', label: 'Android' },
    ios: { id: 'ios', label: 'iOS' },
    web: { id: 'web', label: 'Сайт' },
    // Only an explicit platform value can select this icon. Neither Windows nor
    // Android proves VR mode, and avatar/user tags are not client telemetry.
    vr: { id: 'vr', label: 'VR' },
  };
  return {
    ...(Object.hasOwn(known, platform)
      ? known[platform]
      : { id: 'unknown', label: 'Платформа неизвестна' }),
    raw,
  };
}
