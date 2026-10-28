package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.junit.Test;

public class LauncherIconPolicyTest {
    private Map<LauncherIconPolicy.Icon, Integer> defaults() {
        Map<LauncherIconPolicy.Icon, Integer> result = new EnumMap<>(LauncherIconPolicy.Icon.class);
        for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values())
            result.put(icon, LauncherIconPolicy.DEFAULT);
        return result;
    }

    private int visible(Map<LauncherIconPolicy.Icon, Integer> states) {
        int count = 0;
        for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values())
            if (LauncherIconPolicy.enabled(icon, states.get(icon))) count++;
        return count;
    }

    @Test public void acceptsTheEightCanonicalStylesAndRejectsUnexpectedInput() {
        assertEquals(LauncherIconPolicy.Icon.STANDARD, LauncherIconPolicy.Icon.fromHoliday(null));
        Set<String> ids = new HashSet<>(), aliases = new HashSet<>();
        for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values()) {
            assertSame(icon, LauncherIconPolicy.Icon.fromHoliday(icon.id));
            assertTrue(ids.add(icon.id));
            assertTrue(aliases.add(icon.className("com.diskreid.vrcnextmobile")));
            assertTrue(icon.className("com.diskreid.vrcnextmobile").startsWith(
                    "com.diskreid.vrcnextmobile.launcher."));
            assertFalse(icon.className("com.diskreid.vrcnextmobile").endsWith("MainActivity"));
        }
        assertEquals(8, ids.size());
        for (String bad : new String[] { "", " Halloween", "HALLOWEEN", "valentines", "../MainActivity", "false" })
            assertThrows(IllegalArgumentException.class, () -> LauncherIconPolicy.Icon.fromHoliday(bad));
    }

    @Test public void freshInstallAlreadyShowsOnlyStandardWithoutWritingOverrides() {
        Map<LauncherIconPolicy.Icon, Integer> states = defaults();
        assertEquals(1, visible(states));
        assertTrue(LauncherIconPolicy.changes(LauncherIconPolicy.Icon.STANDARD, states).isEmpty());
        for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values()) {
            if (icon == LauncherIconPolicy.Icon.STANDARD) continue;
            List<LauncherIconPolicy.Change> changes = LauncherIconPolicy.changes(icon, states);
            assertEquals(2, changes.size());
            assertSame(icon, changes.get(0).icon);
            assertEquals(LauncherIconPolicy.ENABLED, changes.get(0).state);
            assertSame(LauncherIconPolicy.Icon.STANDARD, changes.get(1).icon);
            assertEquals(LauncherIconPolicy.DISABLED, changes.get(1).state);
        }
    }

    @Test public void establishedHolidayIsANoopAndReturningToStandardEnablesItFirst() {
        Map<LauncherIconPolicy.Icon, Integer> states = defaults();
        states.put(LauncherIconPolicy.Icon.STANDARD, LauncherIconPolicy.DISABLED);
        states.put(LauncherIconPolicy.Icon.HALLOWEEN, LauncherIconPolicy.ENABLED);
        assertTrue(LauncherIconPolicy.changes(LauncherIconPolicy.Icon.HALLOWEEN, states).isEmpty());
        List<LauncherIconPolicy.Change> changes = LauncherIconPolicy.changes(
                LauncherIconPolicy.Icon.STANDARD, states);
        assertEquals(2, changes.size());
        assertSame(LauncherIconPolicy.Icon.STANDARD, changes.get(0).icon);
        for (LauncherIconPolicy.Change change : changes) {
            states.put(change.icon, change.state);
            assertTrue(visible(states) >= 1);
        }
        assertEquals(1, visible(states));
        assertTrue(LauncherIconPolicy.enabled(LauncherIconPolicy.Icon.STANDARD,
                states.get(LauncherIconPolicy.Icon.STANDARD)));
    }

    @Test public void repairsSeveralEnabledAliasesWithoutEverRemovingAllLauncherEntries() {
        Map<LauncherIconPolicy.Icon, Integer> states = defaults();
        states.put(LauncherIconPolicy.Icon.VALENTINE, LauncherIconPolicy.ENABLED);
        states.put(LauncherIconPolicy.Icon.CHRISTMAS, LauncherIconPolicy.ENABLED);
        List<LauncherIconPolicy.Change> changes = LauncherIconPolicy.changes(
                LauncherIconPolicy.Icon.EASTER, states);
        assertEquals(4, changes.size());
        assertSame(LauncherIconPolicy.Icon.EASTER, changes.get(0).icon);
        for (LauncherIconPolicy.Change change : changes) {
            states.put(change.icon, change.state);
            assertTrue(visible(states) >= 1);
        }
        assertEquals(1, visible(states));
        assertTrue(LauncherIconPolicy.changes(LauncherIconPolicy.Icon.EASTER, states).isEmpty());
        assertThrows(UnsupportedOperationException.class, () -> changes.clear());
    }

    @Test public void eachRequestedStyleConvergesFromDefaultExplicitAndUserDisabledStates() {
        Random random = new Random(45318);
        for (LauncherIconPolicy.Icon requested : LauncherIconPolicy.Icon.values()) {
            for (int sample = 0; sample < 500; sample++) {
                Map<LauncherIconPolicy.Icon, Integer> states = defaults();
                int needed = 0;
                for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values()) {
                    states.put(icon, random.nextInt(5));
                    if (LauncherIconPolicy.enabled(icon, states.get(icon)) != (icon == requested)) needed++;
                }
                List<LauncherIconPolicy.Change> changes = LauncherIconPolicy.changes(requested, states);
                assertEquals(needed, changes.size());
                for (LauncherIconPolicy.Change change : changes) {
                    states.put(change.icon, change.state);
                    assertTrue(visible(states) >= 1);
                }
                assertEquals(1, visible(states));
                assertTrue(LauncherIconPolicy.enabled(requested, states.get(requested)));
                assertTrue(LauncherIconPolicy.changes(requested, states).isEmpty());
            }
        }
    }

    @Test public void rejectsIncompleteOrUnknownComponentStates() {
        Map<LauncherIconPolicy.Icon, Integer> incomplete = defaults();
        incomplete.remove(LauncherIconPolicy.Icon.EARTH_DAY);
        assertThrows(IllegalArgumentException.class, () -> LauncherIconPolicy.changes(
                LauncherIconPolicy.Icon.STANDARD, incomplete));
        Map<LauncherIconPolicy.Icon, Integer> bad = defaults();
        bad.put(LauncherIconPolicy.Icon.VALENTINE, 42);
        assertThrows(IllegalArgumentException.class, () -> LauncherIconPolicy.changes(
                LauncherIconPolicy.Icon.STANDARD, bad));
    }
}
