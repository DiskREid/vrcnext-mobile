import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { UploadTag } from './types';

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
  sessionState(): Promise<{ hasAuth: boolean }>;
  loadImage(options: { url: string }): Promise<{ dataUrl: string }>;
  request(options: NativeRequest): Promise<NativeResponse>;
  searchPublicAvatars(options: { query: string; page: number }): Promise<NativeResponse>;
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
