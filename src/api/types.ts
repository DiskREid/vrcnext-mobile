/** VRChat responses retain optional fields as the upstream API evolves. */
export type Status = 'active' | 'join me' | 'ask me' | 'busy' | 'offline';
export interface User {
  id: string;
  displayName: string;
  username?: string;
  status?: Status | string;
  statusDescription?: string;
  bio?: string;
  bioLinks?: string[];
  pronouns?: string;
  languages?: string[];
  tags?: string[];
  location?: string;
  worldId?: string;
  instanceId?: string;
  state?: string;
  last_login?: string;
  last_activity?: string;
  userIcon?: string;
  iconUrl?: string;
  profilePicOverride?: string;
  profilePicOverrideThumbnail?: string;
  currentAvatarImageUrl?: string;
  currentAvatarThumbnailImageUrl?: string;
  currentAvatar?: string;
  currentAvatarName?: string;
  currentAvatarAuthorName?: string;
  currentAvatarTags?: string[];
  profileBannerUrl?: string;
  isFriend?: boolean;
  friendKey?: string;
  note?: string;
  homeLocation?: string;
  ageVerificationStatus?: string;
  date_joined?: string;
  friendRequestStatus?: string;
  onlineFriends?: string[];
  offlineFriends?: string[];
  activeFriends?: string[];
  friends?: string[];
  avatarImage?: string;
}
export interface UnityPackage {
  platform?: string;
  unityVersion?: string;
  assetUrl?: string;
}
export interface World {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  thumbnailImageUrl?: string;
  authorId?: string;
  authorName?: string;
  capacity?: number;
  recommendedCapacity?: number;
  occupants?: number;
  publicOccupants?: number;
  privateOccupants?: number;
  favorites?: number;
  visits?: number;
  tags?: string[];
  instances?: [string, number, Record<string, number>?][];
  releaseStatus?: string;
  unityPackages?: UnityPackage[];
  favoriteId?: string;
  created_at?: string;
  updated_at?: string;
}
export interface Group {
  id: string;
  groupId?: string;
  name: string;
  description?: string;
  shortCode?: string;
  discriminator?: string;
  memberCount?: number;
  onlineMemberCount?: number;
  iconUrl?: string;
  bannerUrl?: string;
  ownerId?: string;
  rules?: string;
  joinState?: string;
  membershipStatus?: string;
  mutualGroup?: boolean;
  isMember?: boolean;
  myMember?: { id?: string; membershipStatus?: string; roleIds?: string[]; mRoleIds?: string[]; permissions?: string[] } | null;
  roles?: { id: string; name: string; defaultRole?: boolean; permissions?: string[] }[];
  languages?: string[];
  links?: string[];
  galleries?: { id: string; name: string }[];
}
export interface GroupPost {
  id: string;
  title?: string;
  text?: string;
  imageUrl?: string;
  createdAt?: string;
  authorId?: string;
  visibility?: string;
}
/** Verified avatar-file metadata can have a real name without a discoverable avatar ID. */
export interface AvatarMetadata {
  id?: string;
  name: string;
  authorName?: string;
  authorId?: string;
  imageUrl?: string;
  thumbnailImageUrl?: string;
  source?: 'avtrdb' | 'icu' | 'vrchat-file';
}
export interface Avatar {
  id: string;
  name: string;
  description?: string;
  authorId?: string;
  authorName?: string;
  imageUrl?: string;
  thumbnailImageUrl?: string;
  releaseStatus?: string;
  unityPackages?: UnityPackage[];
  tags?: string[];
  favoriteId?: string;
  compatibility?: string[];
  source?: 'avtrdb';
}
export interface Notification {
  id: string;
  type: string;
  senderUserId?: string;
  senderUsername?: string;
  message?: string;
  created_at?: string;
  createdAt?: string;
  seen?: boolean;
  details?: Record<string, unknown>;
  imageUrl?: string;
  title?: string;
  senderDisplayName?: string;
  link?: string;
  data?: Record<string, unknown> | string;
  _v2?: boolean;
  _protocol?: 'v1' | 'modern-v2' | 'legacy-v2';
  canDelete?: boolean;
  _data?: Record<string, unknown>;
  _link?: string;
}
export interface Instance {
  id?: string;
  instanceId?: string;
  worldId?: string;
  location?: string;
  type?: string;
  n_users?: number;
  userCount?: number;
  region?: string;
  ownerId?: string;
  groupAccessType?: string;
  displayName?: string;
  minimumAvatarPerformance?: string | null;
  world?: World;
}
export type FavoriteType = 'friend' | 'world' | 'avatar' | 'vrcPlusWorld';
export interface Favorite {
  id: string;
  favoriteId: string;
  type: FavoriteType;
  tags: string[];
}
export interface FavoriteGroup {
  id?: string;
  type: FavoriteType;
  name: string;
  displayName: string;
  visibility?: string;
}
export interface CalendarEvent {
  id: string;
  groupId?: string;
  ownerId?: string;
  title?: string;
  name?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  startDate?: string;
  endDate?: string;
  imageUrl?: string;
  isFollowing?: boolean;
  userInterest?: { isFollowing?: boolean };
  featured?: boolean;
  worldId?: string;
  group?: Group;
  category?: string;
}
export interface VrcFileVersion {
  version?: number;
  status?: string;
  file?: { url?: string; fileName?: string; sizeInBytes?: number };
  image?: { url?: string };
  created_at?: string;
}
export interface VrcFile {
  id: string;
  name?: string;
  tags?: string[];
  mimeType?: string;
  extension?: string;
  versions?: VrcFileVersion[];
  imageUrl?: string;
  thumbnailImageUrl?: string;
  created_at?: string;
  createdAt?: string;
  note?: string;
  authorId?: string;
  fileUrl?: string;
  image?: { url?: string };
  worldId?: string;
  worldName?: string;
}
export interface InventoryItem {
  id: string;
  name?: string;
  imageUrl?: string;
  itemType?: string;
  quantity?: number;
  template?: { id?: string; name?: string; imageUrl?: string; itemType?: string };
  templateId?: string;
}
export interface Moderation {
  id: string;
  type: 'block' | 'mute';
  targetUserId?: string;
  targetDisplayName?: string;
}
export interface MessageTemplate {
  slot: number;
  message: string;
  canBeUpdated: boolean;
  remainingCooldownMinutes?: number;
}
export type MessageType = 'message' | 'request' | 'response' | 'requestResponse';
export type TwoFactorType = 'totp' | 'emailotp' | 'otp';
export interface TwoFactorChallenge {
  requiresTwoFactorAuth: string[];
}
export interface ProfileUpdate {
  status?: string;
  statusDescription?: string;
  bio?: string;
  pronouns?: string;
  languages?: string[];
  bioLinks?: string[];
  userIcon?: string;
  homeLocation?: string;
}
export interface CreateInstanceOptions {
  worldId: string;
  type: 'public' | 'friends' | 'hidden' | 'private' | 'group';
  region: 'us' | 'use' | 'eu' | 'jp';
  ownerId?: string;
  canRequestInvite?: boolean;
  groupAccessType?: 'public' | 'plus' | 'members';
  displayName?: string;
  queueEnabled?: boolean;
  ageGate?: boolean;
  roleIds?: string[];
  minimumAvatarPerformance?: 'Good' | 'Medium' | 'Poor';
}
export type UploadTag = 'gallery' | 'icon' | 'emoji' | 'sticker';
