package com.diskreid.vrcnextmobile;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.function.LongSupplier;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;

/** Session cookie policy independent of Android storage, so actual OkHttp parsing is regression-tested. */
final class SessionCookies implements CookieJar {
    static final HttpUrl ORIGIN = HttpUrl.get("https://api.vrchat.cloud/api/1/");
    private static final HttpUrl LOGIN = HttpUrl.get("https://api.vrchat.cloud/api/1/auth/user");
    private final List<Cookie> values = new ArrayList<>();
    private final LongSupplier clock;

    SessionCookies() { this(System::currentTimeMillis); }
    SessionCookies(LongSupplier clock) { this.clock = clock; }

    private static boolean isOrigin(HttpUrl url) {
        return url.isHttps() && url.host().equals(ORIGIN.host()) && url.port() == 443;
    }

    private static Cookie canonical(Cookie cookie) {
        if (cookie == null || !(cookie.name().equals("auth") || cookie.name().equals("twoFactorAuth"))) return null;
        // VRChat documents Set-Cookie without Secure. Accept it only from our fixed HTTPS origin,
        // then make it stricter locally. The wider vrchat.cloud Domain is narrowed to the API host.
        if (!cookie.domain().equals(ORIGIN.host()) && !cookie.domain().equals("vrchat.cloud")) return null;
        if (cookie.hostOnly() && !cookie.domain().equals(ORIGIN.host())) return null;
        Cookie.Builder result = new Cookie.Builder().name(cookie.name()).value(cookie.value())
                .hostOnlyDomain(ORIGIN.host()).path(cookie.path()).secure().httpOnly();
        if (cookie.persistent()) result.expiresAt(cookie.expiresAt());
        return result.build();
    }

    /** Returns whether storage changed; empty/non-session responses must not create Keystore keys. */
    synchronized boolean receive(HttpUrl url, List<Cookie> incoming) {
        if (!isOrigin(url)) return false;
        List<Cookie> before = new ArrayList<>(values);
        long now = clock.getAsLong();
        values.removeIf(cookie -> cookie.expiresAt() <= now);
        for (Cookie raw : incoming) {
            Cookie cookie = canonical(raw);
            if (cookie == null) continue;
            Iterator<Cookie> old = values.iterator();
            while (old.hasNext()) {
                Cookie existing = old.next();
                if (existing.name().equals(cookie.name()) && existing.path().equals(cookie.path())) old.remove();
            }
            // A deletion Set-Cookie often omits Secure too; still remove the existing canonical cookie.
            if (cookie.expiresAt() > now) values.add(cookie);
        }
        return !before.equals(values);
    }

    @Override public void saveFromResponse(HttpUrl url, List<Cookie> cookies) { receive(url, cookies); }

    @Override public synchronized List<Cookie> loadForRequest(HttpUrl url) {
        if (!isOrigin(url)) return Collections.emptyList();
        List<Cookie> result = new ArrayList<>();
        long now = clock.getAsLong();
        for (Cookie cookie : values) if (cookie.expiresAt() > now && cookie.matches(url)) result.add(cookie);
        result.sort(Comparator.comparingInt((Cookie cookie) -> cookie.path().length()).reversed());
        return result;
    }

    synchronized String token(String name) {
        for (Cookie cookie : loadForRequest(LOGIN)) if (cookie.name().equals(name)) return cookie.value();
        return null;
    }

    synchronized List<Cookie> snapshot() {
        List<Cookie> result = new ArrayList<>();
        for (Cookie cookie : values) if (cookie.expiresAt() > clock.getAsLong()) result.add(cookie);
        return result;
    }

    synchronized void clear() { values.clear(); }
}
