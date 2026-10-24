package com.diskreid.vrcnextmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.content.pm.ActivityInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run on a dedicated test device with no saved account. Never submits credentials or clears data. */
@RunWith(AndroidJUnit4.class)
public class MobileStartupTest {
    private static final String READY = "Boolean(document.querySelector('input[autocomplete=\"username\"]') && "
            + "document.querySelector('input[autocomplete=\"current-password\"]') && "
            + "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Войти в VRChat')&&!b.disabled))";

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch complete = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            if (activity.getBridge() == null || activity.getBridge().getWebView() == null) {
                result.set("missing-webview"); complete.countDown(); return;
            }
            activity.getBridge().getWebView().evaluateJavascript(script, value -> {
                result.set(value); complete.countDown();
            });
        });
        assertTrue("WebView callback did not complete", complete.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private static void awaitLogin(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 45000;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(scenario, READY))) return;
            Thread.sleep(250);
        }
        throw new AssertionError("Login form did not become usable. "
                + AppDiagnostics.getReport(InstrumentationRegistry.getInstrumentation().getTargetContext()).text);
    }

    @Test public void freshLoginIsUsableAndSurvivesRotationWithoutSubmittingCredentials() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        assertEquals("com.diskreid.vrcnextmobile", instrumentation.getTargetContext().getPackageName());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitLogin(scenario);
            assertEquals("true", evaluate(scenario,
                    "(()=>{const i=document.querySelector('input[autocomplete=\"username\"]');"
                    + "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'startup-fixture');"
                    + "i.dispatchEvent(new Event('input',{bubbles:true}));return i.value==='startup-fixture'})()"));
            scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
            awaitLogin(scenario);
            assertEquals("true", evaluate(scenario,
                    "document.querySelector('input[autocomplete=\"username\"]').value==='startup-fixture'"));
            scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
            awaitLogin(scenario);
        }
    }
}
