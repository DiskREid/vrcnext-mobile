import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AndroidApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { api, isNative } from '../api';
import type { PipelineEvent, User } from '../api';
import type { HistoryState } from './history';
import { ProfileHistorySynchronizer } from './profile-history-sync';

/** Public profiles are sampled gradually, only while this account is in the foreground. */
export function useProfileHistorySync(account: string | undefined, demo: boolean, online: boolean,
  friends: User[], history: HistoryState) {
  const destination = useRef({ account, observe: history.observeProfile });
  destination.current = { account, observe: history.observeProfile };
  const controller = useMemo(() => account && !demo ? new ProfileHistorySynchronizer(account, {
    load: id => api.userProfile(id),
    observe: fresh => {
      if (destination.current.account === account) destination.current.observe(fresh, 'sync');
    },
  }) : undefined, [account, demo]);
  const [state, setState] = useState(controller?.state);
  const [nativeActive, setNativeActive] = useState(!isNative);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    setState(controller?.state);
    if (!controller) return;
    const unsubscribe = controller.subscribe(setState);
    return () => { unsubscribe(); controller.dispose(); };
  }, [controller]);
  useEffect(() => { controller?.setFriends(friends); }, [controller, friends]);
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
    return () => { live = false; controller.setActive(false); void handle?.remove(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('offline', offline); };
  }, [controller]);
  useEffect(() => {
    // Activate after React has run the other observation effects' pause cleanups.
    // Starting directly in appStateChange can create a fresh baseline just before
    // useObservation's foreground transition clears it again.
    controller?.setActive(online && nativeActive && visible);
    return () => controller?.setActive(false);
  }, [controller, online, nativeActive, visible]);
  const refresh = useCallback(() => controller?.refresh(), [controller]);
  const handlePipeline = useCallback((event: PipelineEvent) => controller?.handlePipeline(event), [controller]);
  // A new account must not briefly display the previous account's progress or errors.
  const displayed = controller && state === controller.state ? state : controller?.state;
  return { ...displayed, available: !!controller, refresh, handlePipeline };
}
export type ProfileHistorySync = ReturnType<typeof useProfileHistorySync>;
