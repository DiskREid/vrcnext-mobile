import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { UploadTag } from './types';
import type { HolidayId } from '../data/holiday-calendar';

export interface NativeResponse {
  status: number;
  data: unknown;
  retryAfter?: number;
}
export interface NativeRequest {
  path: string;
  method?: string;
  body?: string;
  authorization?: string;
}
export interface PipelineEvent {
  type: string;
  content: Record<string, unknown>;
}
export interface NativeBridge {
  setLauncherIcon(options: {
    holiday: HolidayId | null;
  }): Promise<{ icon: HolidayId | 'standard'; changed: boolean }>;
  sessionState(): Promise<{ hasAuth: boolean }>;
  screenProtection(): Promise<{ enabled: boolean }>;
  setScreenProtection(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  loadImage(options: { url: string; maxDimension?: number }): Promise<{ dataUrl: string }>;
  downloadImage(options: {
    url: string;
    fileName: string;
  }): Promise<{ saved: boolean; fileName: string }>;
  request(options: NativeRequest): Promise<NativeResponse>;
  searchPublicAvatars(options: { query: string; page: number }): Promise<NativeResponse>;
  resolvePublicAvatar(options: {
    fileId: string;
    source?: 'avtrdb' | 'icu';
  }): Promise<NativeResponse>;
  clearSession(): Promise<void>;
  connectPipeline(): Promise<void>;
  disconnectPipeline(): Promise<void>;
  uploadImage(options: {
    tag: UploadTag;
    data: string;
    mimeType: string;
    fileName: string;
  }): Promise<NativeResponse>;
  openLink(options: { url: string }): Promise<void>;
  copyText(options: { text: string }): Promise<void>;
  exportJson(options: { fileName: string; json: string }): Promise<{ saved: boolean }>;
  addListener(
    eventName: 'pipeline',
    listener: (event: PipelineEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'connection',
    listener: (event: { state: string }) => void,
  ): Promise<PluginListenerHandle>;
}
export const native = registerPlugin<NativeBridge>('VrcNative');
export const isNative = Capacitor.isNativePlatform();
