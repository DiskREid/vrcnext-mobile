package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class LifecycleTasksTest {
    @Test public void lateBridgeInvocationAfterCloseCancelsWithoutSubmitting() {
        LifecycleTasks tasks = new LifecycleTasks();
        tasks.close();
        AtomicInteger submitted = new AtomicInteger(), cancelled = new AtomicInteger();
        assertFalse(tasks.execute(command -> submitted.incrementAndGet(), () -> fail("Retired task ran"), cancelled::incrementAndGet));
        assertEquals(0, submitted.get());
        assertEquals(1, cancelled.get());
    }

    @Test public void queuedWorkDoesNotRunAfterWebViewIsRetired() {
        LifecycleTasks tasks = new LifecycleTasks();
        List<Runnable> queue = new ArrayList<>();
        AtomicInteger work = new AtomicInteger(), cancelled = new AtomicInteger();
        assertTrue(tasks.execute(queue::add, work::incrementAndGet, cancelled::incrementAndGet));
        tasks.close();
        queue.get(0).run();
        assertEquals(0, work.get());
        assertEquals(1, cancelled.get());
    }

    @Test public void shutdownBetweenOpenCheckAndSubmissionIsCancellationNotAnUncaughtException() {
        LifecycleTasks tasks = new LifecycleTasks();
        AtomicInteger cancelled = new AtomicInteger();
        assertFalse(tasks.execute(command -> {
            tasks.close();
            throw new RejectedExecutionException("Synthetic shutdown race");
        }, () -> fail("Retired task ran"), cancelled::incrementAndGet));
        assertEquals(1, cancelled.get());
    }

    @Test public void actualStoppedExecutorCannotCrashCaller() {
        LifecycleTasks tasks = new LifecycleTasks();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.shutdownNow();
        AtomicInteger cancelled = new AtomicInteger();
        assertFalse(tasks.execute(executor, () -> fail("Stopped executor ran work"), cancelled::incrementAndGet));
        assertEquals(1, cancelled.get());
    }

    @Test public void reconnectScheduleShutdownAndAlreadyQueuedReconnectAreSafe() {
        LifecycleTasks tasks = new LifecycleTasks();
        ScheduledThreadPoolExecutor stopped = new ScheduledThreadPoolExecutor(1);
        stopped.shutdownNow();
        assertFalse(tasks.schedule(stopped, () -> fail("Stopped reconnect ran"), 1, TimeUnit.SECONDS));
        List<Runnable> queued = new ArrayList<>();
        ScheduledThreadPoolExecutor recording = new ScheduledThreadPoolExecutor(1) {
            @Override public ScheduledFuture<?> schedule(Runnable command, long delay, TimeUnit unit) {
                queued.add(command);
                return null;
            }
        };
        try {
            AtomicInteger reconnects = new AtomicInteger();
            assertTrue(tasks.schedule(recording, reconnects::incrementAndGet, 1, TimeUnit.SECONDS));
            tasks.close();
            queued.get(0).run();
            assertEquals(0, reconnects.get());
            assertFalse(tasks.schedule(recording, reconnects::incrementAndGet, 1, TimeUnit.SECONDS));
        } finally { recording.shutdownNow(); }
    }

    @Test public void failedReleaseOfRetiredCallDoesNotCreateAnotherCrash() {
        LifecycleTasks tasks = new LifecycleTasks();
        tasks.close();
        assertFalse(tasks.execute(Runnable::run, () -> fail("Retired task ran"), () -> {
            throw new IllegalStateException("Synthetic retired bridge");
        }));
    }
}
