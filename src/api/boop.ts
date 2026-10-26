import type { VrcFile } from './types';

export type BoopSelection = { emojiId: string; emojiVersion?: number; inventoryItemId?: never } | { inventoryItemId: string; emojiId?: never; emojiVersion?: never };
export type BoopChoice = { id: string; name: string; preview: string; selection: BoopSelection };
const fileId = (value: unknown): value is string => typeof value === 'string' && /^file_[a-zA-Z0-9-]+$/.test(value);
const inventoryId = (value: unknown): value is string => typeof value === 'string' && /^inv_[a-zA-Z0-9-]+$/.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** VRChat Boop accepts an emoji or an inventory emoji, never an arbitrary sticker ID. */
export function boopPayload(selection?: BoopSelection): Record<string, string | number> {
  if (!selection) return {};
  if (inventoryId(selection.inventoryItemId) && selection.emojiId === undefined && selection.emojiVersion === undefined)
    return { inventoryItemId: selection.inventoryItemId };
  if (selection.inventoryItemId === undefined && typeof selection.emojiId === 'string'
      && (fileId(selection.emojiId) || /^default_[a-z0-9_]+$/.test(selection.emojiId))) {
    if (selection.emojiVersion !== undefined && (!Number.isInteger(selection.emojiVersion) || selection.emojiVersion < 1 || !fileId(selection.emojiId)))
      throw new Error('Некорректная версия эмодзи Boop. Выберите эмодзи заново.');
    return { emojiId: selection.emojiId, ...(selection.emojiVersion === undefined ? {} : { emojiVersion: selection.emojiVersion }) };
  }
  throw new Error('Для Boop нужен доступный эмодзи VRChat. Обычные стикеры не поддерживаются.');
}

// Same default IDs and artwork used by the original PC Boop picker (VRChat default emoji).
export const defaultBoopChoices: BoopChoice[] = [
  ['default_hand_wave', 'Привет', 'Handwave.webp'], ['default_heart', 'Сердце', 'Love.webp'],
  ['default_smile', 'Улыбка', 'Smile.webp'], ['default_laugh', 'Смех', 'Laugh.webp'],
  ['default_in_love', 'Влюблённость', 'Inlove.webp'], ['default_kiss', 'Поцелуй', 'Kiss.webp'],
  ['default_thinking', 'Думаю', 'Thinking.webp'], ['default_thumbs_up', 'Супер', 'Like.webp'],
  ['default_thumbs_down', 'Неодобрение', 'Dislike.webp'], ['default_wow', 'Удивление', 'Wow.webp'],
  ['default_angry', 'Злюсь', 'Angry.webp'], ['default_blushing', 'Смущение', 'Blush.webp'],
  ['default_crying', 'Плачу', 'Crying.webp'], ['default_sunglasses', 'Круто', 'Sunglasses.webp'],
  ['default_zzz', 'Сон', 'ZZZZ.webp'], ['default_fire', 'Огонь', 'Fire.webp'],
].map(([id, name, image]) => ({ id, name, preview: '/boop/' + image, selection: { emojiId: id } }));

export function fileBoopChoices(files: VrcFile[]): BoopChoice[] {
  return files.flatMap((file) => {
    if (!fileId(file.id)) return [];
    const version = [...(file.versions || [])].sort((a, b) => (b.version || 0) - (a.version || 0)).find((item) => (!item.status || item.status === 'complete') && item.file?.url);
    const preview = file.thumbnailImageUrl || file.imageUrl || file.fileUrl || version?.file?.url || file.image?.url;
    if (!preview) return [];
    return [{ id: file.id, name: file.note || file.name || 'Мой эмодзи', preview,
      selection: { emojiId: file.id, ...(version?.version && Number.isInteger(version.version) && version.version > 0 ? { emojiVersion: version.version } : {}) } }];
  });
}

export function inventoryBoopChoices(items: unknown[], now = Date.now()): BoopChoice[] {
  return items.flatMap((item) => {
    const row = record(item), template = record(row.template), metadata = record(row.metadata);
    if ((row.itemType || template.itemType) !== 'emoji' || !inventoryId(row.id) || row.isArchived === true
        || typeof row.expiryDate === 'string' && Date.parse(row.expiryDate) <= now) return [];
    const preview = [row.imageUrl, metadata.imageUrl, template.imageUrl].find((value): value is string => typeof value === 'string' && !!value);
    if (!preview) return [];
    return [{ id: row.id, name: typeof row.name === 'string' && row.name || typeof template.name === 'string' && template.name || 'Коллекционный эмодзи', preview,
      selection: { inventoryItemId: row.id } }];
  });
}
