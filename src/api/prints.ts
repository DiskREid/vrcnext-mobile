/** Prints are a separate API entity; their media is not a File.versions array. */
export interface Print {
  id: string;
  authorId?: string;
  authorName?: string;
  ownerId?: string;
  note?: string;
  createdAt?: string;
  timestamp?: string;
  worldId?: string;
  worldName?: string;
  files?: { fileId?: string; image?: string };
  // Some older responses include these flattened preview fields.
  imageUrl?: string;
  thumbnailImageUrl?: string;
  fileUrl?: string;
}

const mediaHosts = new Set([
  'api.vrchat.cloud',
  'api.vrchat.com',
  'vrchat.com',
  'cloud.vrchat.com',
  'files.vrchat.cloud',
  'file-variants.vrchat.com',
  'assets.vrchat.com',
]);

/** Preserve signed queries and file versions; never construct guessed file URLs. */
function mediaUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      mediaHosts.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === '443')
      ? value
      : '';
  } catch {
    return '';
  }
}

export function printMedia(print: Print) {
  const original =
    mediaUrl(print.files?.image) ||
    mediaUrl(print.fileUrl) ||
    mediaUrl(print.imageUrl);
  return {
    original,
    thumbnail: mediaUrl(print.thumbnailImageUrl) || original,
  };
}

export function printDate(print: Print) {
  return [print.createdAt, print.timestamp].find(
    (value) => value && Number.isFinite(Date.parse(value)),
  );
}
