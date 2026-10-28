package com.diskreid.vrcnextmobile;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Pure launcher policy; component state is persisted by Android, not by account preferences. */
final class LauncherIconPolicy {
    static final int DEFAULT = 0;
    static final int ENABLED = 1;
    static final int DISABLED = 2;

    enum Icon {
        STANDARD("standard", "Standard", true),
        VALENTINE("valentine", "Valentine", false),
        WOMENS_DAY("womens-day", "WomensDay", false),
        ST_PATRICK("st-patrick", "StPatrick", false),
        EASTER("easter", "Easter", false),
        EARTH_DAY("earth-day", "EarthDay", false),
        HALLOWEEN("halloween", "Halloween", false),
        CHRISTMAS("christmas", "Christmas", false);

        final String id;
        final String alias;
        final boolean manifestEnabled;

        Icon(String id, String alias, boolean manifestEnabled) {
            this.id = id;
            this.alias = alias;
            this.manifestEnabled = manifestEnabled;
        }

        String className(String packageName) {
            return packageName + ".launcher." + alias;
        }

        static Icon fromHoliday(String holiday) {
            if (holiday == null) return STANDARD;
            for (Icon icon : values()) if (icon.id.equals(holiday)) return icon;
            throw new IllegalArgumentException("Unknown launcher icon");
        }
    }

    static final class Change {
        final Icon icon;
        final int state;

        Change(Icon icon, int state) {
            this.icon = icon;
            this.state = state;
        }
    }

    static boolean enabled(Icon icon, int override) {
        if (override < DEFAULT || override > 4)
            throw new IllegalArgumentException("Unknown component state");
        return override == ENABLED || (override == DEFAULT && icon.manifestEnabled);
    }

    /** Enabling first keeps API26–32 transitions launchable without killing the running activity. */
    static List<Change> changes(Icon requested, Map<Icon, Integer> states) {
        if (requested == null) throw new IllegalArgumentException("A launcher icon is required");
        for (Icon icon : Icon.values()) {
            if (!states.containsKey(icon) || states.get(icon) == null)
                throw new IllegalArgumentException("Missing launcher state");
            enabled(icon, states.get(icon));
        }
        List<Change> result = new ArrayList<>();
        if (!enabled(requested, states.get(requested))) result.add(new Change(requested, ENABLED));
        for (Icon icon : Icon.values()) {
            if (icon != requested && enabled(icon, states.get(icon)))
                result.add(new Change(icon, DISABLED));
        }
        return Collections.unmodifiableList(result);
    }
}
