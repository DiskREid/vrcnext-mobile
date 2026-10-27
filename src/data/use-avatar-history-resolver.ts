import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AndroidApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { api, isNative } from '../api';
import type { HistoryEvent, HistoryState } from './history';
import { AvatarHistoryResolver } from './avatar-history-resolver';

/** Resolve metadata only for an avatar change already received through the pipeline. */
export function useAvatarHistoryResolver(account: string | undefined, demo: boolean, online: boolean,
  history: HistoryState) {
  const destination = useRef({ account, enrich: history.enrichAvatar });
  destination.current = { account, enrich: history.enrichAvatar };
  const controller = useMemo(() => account && !demo ? new AvatarHistoryResolver(account, {
    resolve: fileId => api.resolvePublicAvatar(fileId),
    enrich: (eventId, fileId, avatar) => {
      if (destination.current.account === account) destination.current.enrich(eventId, fileId, avatar);
    },
  }) : undefined, [account, demo]);
  const [nativeActive, setNativeActive] = useState(!isNative);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => () => controller?.dispose(), [controller]);
  useEffect(() => {
    if (!controller) return;
    let live = true, nativeRevision = 0;
    let handle: PluginListenerHandle | undefined;
    const visibility = () => {
      const active = document.visibilityState === 'visible';
      if (!active) controller.setActive(false);
      setVisible(active);
    };
    const offline = () => controller.setActive(false);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', offline);
    if (isNative) {
      const active = (value: boolean) => {
        if (!live) return;
        if (!value) controller.setActive(false);
        setNativeActive(value);
      };
      void AndroidApp.addListener('appStateChange', ({ isActive }) => { nativeRevision++; active(isActive); }).then(listener => {
        if (!live) void listener.remove(); else handle = listener;
      }).catch(() => active(false));
      void AndroidApp.getState().then(({ isActive }) => { if (!nativeRevision) active(isActive); }).catch(() => { if (!nativeRevision) active(false); });
    }
    visibility();
    return () => {
      live = false; controller.setActive(false); void handle?.remove();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('offline', offline);
    };
  }, [controller]);
  useEffect(() => {
    controller?.setActive(online && nativeActive && visible);
    return () => controller?.setActive(false);
  }, [controller, online, nativeActive, visible]);
  const observe = useCallback((events: HistoryEvent[]) => controller?.observe(events), [controller]);
  return { observe };
}
