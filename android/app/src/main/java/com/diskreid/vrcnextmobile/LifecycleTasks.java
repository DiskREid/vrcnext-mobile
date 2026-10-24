package com.diskreid.vrcnextmobile;

import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Cancels queued bridge work when its WebView is retired, including executor-shutdown races. */
final class LifecycleTasks {
    private final AtomicBoolean closed = new AtomicBoolean();

    boolean isClosed() { return closed.get(); }
    void close() { closed.set(true); }

    boolean execute(Executor executor, Runnable work, Runnable cancelled) {
        if (closed.get()) { cancel(cancelled); return false; }
        try {
            executor.execute(() -> {
                if (closed.get()) cancel(cancelled);
                else work.run();
            });
            return true;
        } catch (RejectedExecutionException stopped) {
            cancel(cancelled);
            return false;
        }
    }

    boolean schedule(ScheduledExecutorService executor, Runnable work, long delay, TimeUnit unit) {
        if (closed.get()) return false;
        try {
            executor.schedule(() -> { if (!closed.get()) work.run(); }, delay, unit);
            return true;
        } catch (RejectedExecutionException stopped) {
            return false;
        }
    }

    private static void cancel(Runnable cancelled) {
        try { cancelled.run(); }
        catch (RuntimeException retiredBridge) { /* Cancellation must not crash a retired bridge. */ }
    }
}
