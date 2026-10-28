package com.diskreid.vrcnextmobile;

import android.annotation.TargetApi;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/** Changes launcher aliases only; the real MainActivity is always enabled. */
final class LauncherIconController {
    private static final Object LOCK = new Object();

    private LauncherIconController() {}

    static boolean apply(Context context, LauncherIconPolicy.Icon requested) {
        synchronized (LOCK) {
            PackageManager manager = context.getPackageManager();
            String packageName = context.getPackageName();
            Map<LauncherIconPolicy.Icon, Integer> before = read(manager, packageName);
            List<LauncherIconPolicy.Change> changes = LauncherIconPolicy.changes(requested, before);
            if (changes.isEmpty()) return false;
            if (Build.VERSION.SDK_INT >= 33) {
                AtomicApi33.apply(manager, packageName, changes);
            } else {
                try {
                    for (LauncherIconPolicy.Change change : changes)
                        manager.setComponentEnabledSetting(component(packageName, change.icon),
                                change.state, PackageManager.DONT_KILL_APP);
                } catch (RuntimeException failure) {
                    restore(manager, packageName, before);
                    throw failure;
                }
            }
            Map<LauncherIconPolicy.Icon, Integer> after = read(manager, packageName);
            if (!LauncherIconPolicy.changes(requested, after).isEmpty())
                throw new IllegalStateException("Launcher state was not applied");
            return true;
        }
    }

    private static ComponentName component(String packageName, LauncherIconPolicy.Icon icon) {
        return new ComponentName(packageName, icon.className(packageName));
    }

    private static Map<LauncherIconPolicy.Icon, Integer> read(PackageManager manager, String packageName) {
        Map<LauncherIconPolicy.Icon, Integer> result = new EnumMap<>(LauncherIconPolicy.Icon.class);
        for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values())
            result.put(icon, manager.getComponentEnabledSetting(component(packageName, icon)));
        return result;
    }

    private static void restore(PackageManager manager, String packageName,
            Map<LauncherIconPolicy.Icon, Integer> before) {
        // Restore originally visible entries before retiring a newly enabled alias.
        for (boolean visible : new boolean[] { true, false }) {
            for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values()) {
                int state = before.get(icon);
                if (LauncherIconPolicy.enabled(icon, state) != visible) continue;
                try {
                    if (manager.getComponentEnabledSetting(component(packageName, icon)) != state)
                        manager.setComponentEnabledSetting(component(packageName, icon), state,
                                PackageManager.DONT_KILL_APP);
                } catch (RuntimeException ignored) {
                    // A failed OS operation must not trigger an app restart or disable MainActivity.
                }
            }
        }
    }

    @TargetApi(33)
    private static final class AtomicApi33 {
        static void apply(PackageManager manager, String packageName,
                List<LauncherIconPolicy.Change> changes) {
            List<PackageManager.ComponentEnabledSetting> batch = new ArrayList<>();
            for (LauncherIconPolicy.Change change : changes)
                batch.add(new PackageManager.ComponentEnabledSetting(component(packageName, change.icon),
                        change.state, PackageManager.DONT_KILL_APP));
            manager.setComponentEnabledSettings(batch);
        }
    }
}
