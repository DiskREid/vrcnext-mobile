package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class DiagnosticReportTest {
    @Test public void neverIncludesExceptionMessagesOrSuppressedData() {
        Throwable failure = new IllegalStateException("password=secret123; Cookie: auth=authcookie_private");
        Throwable cause = new IOExceptionFixture("Authorization: Basic private; https://example.com/?authToken=private");
        failure.initCause(cause);
        failure.addSuppressed(new IllegalArgumentException("email@example.com"));
        String summary = DiagnosticReport.exceptionSummary(failure);
        assertTrue(summary.contains("java.lang.IllegalStateException"));
        assertTrue(summary.contains("DiagnosticReportTest.java"));
        assertFalse(summary.contains("secret123"));
        assertFalse(summary.contains("authcookie_private"));
        assertFalse(summary.contains("Authorization"));
        assertFalse(summary.contains("https://"));
        assertFalse(summary.contains("email@example.com"));
    }

    @Test public void boundsFramesAndRejectsMalformedStackMetadata() {
        Throwable failure = new RuntimeException("ignored");
        StackTraceElement[] frames = new StackTraceElement[1000];
        for (int i = 0; i < frames.length; i++)
            frames[i] = new StackTraceElement("com.diskreid.vrcnextmobile.A", "run", "Source.java", i);
        frames[0] = new StackTraceElement("https://example.com/?authToken=private", "token", "private", 1);
        frames[1] = new StackTraceElement("com.diskreid.vrcnextmobile.A", "https://secret", "/private/token=123", 1);
        failure.setStackTrace(frames);
        String summary = DiagnosticReport.exceptionSummary(failure);
        assertFalse(summary.contains("https://"));
        assertFalse(summary.contains("token=123"));
        assertTrue(summary.contains(".unknown(unknown:1)"));
        assertTrue(summary.length() <= DiagnosticReport.MAX_LENGTH);
        assertTrue(summary.split("\n").length <= 25);
    }

    @Test public void boundsCauseCyclesAndSanitizesVersionMetadata() {
        Throwable first = new RuntimeException("secret1");
        Throwable second = new IllegalStateException("secret2");
        first.initCause(second);
        second.initCause(first);
        String summary = DiagnosticReport.exceptionSummary(first);
        assertEquals(1, summary.split("Cause:", -1).length - 1);
        assertFalse(summary.contains("secret"));
        assertEquals("109.0_1234_", DiagnosticReport.label("109.0\n1234\r"));
        assertEquals("unavailable", DiagnosticReport.label(null));
    }

    @Test public void acceptsOnlyFixedJavaScriptFailureCategories() {
        assertEquals("JavaScript failure kind=render name=TypeError\n", DiagnosticReport.webFailure("render", "TypeError"));
        assertEquals("JavaScript failure kind=rejection name=Unknown\n", DiagnosticReport.webFailure("rejection", "Unknown"));
        assertThrows(IllegalArgumentException.class, () -> DiagnosticReport.webFailure("password=secret", "Error"));
        assertThrows(IllegalArgumentException.class, () -> DiagnosticReport.webFailure("runtime", "authToken=private"));
        assertThrows(IllegalArgumentException.class, () -> DiagnosticReport.webFailure("runtime", null));
    }

    private static final class IOExceptionFixture extends RuntimeException {
        IOExceptionFixture(String message) { super(message); }
    }
}
