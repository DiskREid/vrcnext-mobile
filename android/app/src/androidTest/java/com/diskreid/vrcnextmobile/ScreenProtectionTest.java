package com.diskreid.vrcnextmobile;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import android.view.WindowManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run on a dedicated test device; restore its previous display preference after testing. */
@RunWith(AndroidJUnit4.class)
public class ScreenProtectionTest {
    @Test public void changingProtectionUpdatesWindowAndSurvivesActivityRecreation() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        boolean previous = ScreenProtection.isEnabled(context);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try {
                scenario.onActivity(activity -> {
                    ScreenProtection.setEnabled(activity, true);
                    assertEquals(WindowManager.LayoutParams.FLAG_SECURE,
                            activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE);
                });
                scenario.recreate();
                scenario.onActivity(activity -> {
                    assertEquals(true, ScreenProtection.isEnabled(activity));
                    assertEquals(WindowManager.LayoutParams.FLAG_SECURE,
                            activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE);
                    ScreenProtection.setEnabled(activity, false);
                    assertEquals(0, activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE);
                });
                scenario.recreate();
                scenario.onActivity(activity -> {
                    assertEquals(false, ScreenProtection.isEnabled(activity));
                    assertEquals(0, activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE);
                });
            } finally {
                scenario.onActivity(activity -> ScreenProtection.setEnabled(activity, previous));
            }
        }
    }
}
