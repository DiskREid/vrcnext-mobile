package com.diskreid.vrcnextmobile;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

/** Structural crash data only: never use Throwable messages, toString or printStackTrace. */
final class DiagnosticReport {
    static final int MAX_LENGTH = 8192;
    private static final String[] FRAME_PREFIXES = {
            "com.diskreid.", "com.getcapacitor.", "com.capacitorjs.", "android.", "androidx.",
            "java.", "javax.", "kotlin.", "kotlinx.", "okhttp3.", "okio.", "org.json.", "dalvik."
    };

    private DiagnosticReport() { }

    static String exceptionSummary(Throwable failure) {
        StringBuilder output = new StringBuilder();
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<Throwable, Boolean>());
        for (int depth = 0; failure != null && depth < 4 && seen.add(failure); depth++) {
            append(output, (depth == 0 ? "Exception: " : "Cause: ") + identifier(failure.getClass().getName()) + "\n");
            int frames = 0;
            for (StackTraceElement frame : failure.getStackTrace()) {
                if (frames++ >= 24 || output.length() >= MAX_LENGTH - 256) break;
                if (!allowedFrame(frame.getClassName())) continue;
                String method = frame.getMethodName();
                if (!method.matches("[A-Za-z0-9_$<>]{1,128}")) method = "unknown";
                String file = frame.getFileName();
                if (file == null || !file.matches("[A-Za-z0-9_.$-]{1,128}")) file = "unknown";
                String line = frame.getLineNumber() > 0 ? String.valueOf(frame.getLineNumber()) : "?";
                append(output, "  at " + identifier(frame.getClassName()) + "." + method + "(" + file + ":" + line + ")\n");
            }
            failure = failure.getCause();
        }
        return output.toString();
    }

    private static boolean allowedFrame(String name) {
        if (!name.matches("[A-Za-z0-9_.$]{1,256}")) return false;
        for (String prefix : FRAME_PREFIXES) if (name.startsWith(prefix)) return true;
        return false;
    }

    private static String identifier(String value) {
        return value != null && value.matches("[A-Za-z0-9_.$]{1,256}") ? value : "unknown";
    }

    static String webFailure(String kind, String name) {
        if (!("render".equals(kind) || "runtime".equals(kind) || "rejection".equals(kind)))
            throw new IllegalArgumentException("Unsupported failure kind");
        if (!("Error".equals(name) || "TypeError".equals(name) || "RangeError".equals(name)
                || "ReferenceError".equals(name) || "SyntaxError".equals(name) || "URIError".equals(name)
                || "EvalError".equals(name) || "Unknown".equals(name)))
            throw new IllegalArgumentException("Unsupported failure name");
        return "JavaScript failure kind=" + kind + " name=" + name + "\n";
    }

    static String label(String value) {
        if (value == null) return "unavailable";
        String safe = value.replaceAll("[^A-Za-z0-9 ._()+-]", "_");
        return safe.substring(0, Math.min(safe.length(), 96));
    }

    private static void append(StringBuilder output, String text) {
        if (output.length() + text.length() <= MAX_LENGTH) output.append(text);
    }
}
