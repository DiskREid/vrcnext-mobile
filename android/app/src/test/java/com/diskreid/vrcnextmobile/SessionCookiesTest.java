package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.Cookie;
import okhttp3.HttpUrl;
import org.junit.Test;

public class SessionCookiesTest {
    private static final HttpUrl LOGIN = HttpUrl.get("https://api.vrchat.cloud/api/1/auth/user");
    private static final HttpUrl OTP = HttpUrl.get("https://api.vrchat.cloud/api/1/auth/twofactorauth/emailotp/verify");
    private static Cookie parse(HttpUrl url, String header) {
        Cookie cookie = Cookie.parse(url, header);
        assertNotNull("Fixture must parse with real OkHttp", cookie);
        return cookie;
    }
    private static Cookie parse(String header) { return parse(LOGIN, header); }

    @Test public void documentedLoginCookieWithoutSecureSurvivesEmailOtpAndAuthenticatedUserRequest() {
        // Exact synthetic example from vrchatapi/specification CurrentUserLoginResponse.yaml.
        Cookie auth = parse("auth=authcookie_00000000-0000-0000-0000-000000000000; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Path=/; HttpOnly");
        assertFalse("Regression: documented response has no Secure flag", auth.secure());
        SessionCookies jar = new SessionCookies();
        assertTrue(jar.receive(LOGIN, Collections.singletonList(auth)));
        List<Cookie> verificationCookies = jar.loadForRequest(OTP);
        assertEquals(1, verificationCookies.size());
        assertEquals(auth.value(), verificationCookies.get(0).value());
        assertTrue(verificationCookies.get(0).secure());
        assertTrue(verificationCookies.get(0).hostOnly());
        jar.saveFromResponse(OTP, Collections.singletonList(parse(OTP,"twoFactorAuth=synthetic-verified; Path=/; HttpOnly")));
        assertEquals(2, jar.loadForRequest(LOGIN).size());
        assertEquals("synthetic-verified", jar.token("twoFactorAuth"));
    }

    @Test public void acceptsDomainCookieThenNarrowsItAndReplacesItWithoutDuplicates() {
        SessionCookies jar = new SessionCookies();
        jar.saveFromResponse(LOGIN, Collections.singletonList(parse("auth=pending; Domain=vrchat.cloud; Path=/; HttpOnly")));
        assertEquals("api.vrchat.cloud", jar.snapshot().get(0).domain());
        jar.saveFromResponse(OTP, Collections.singletonList(parse(OTP,"auth=verified; Path=/; Secure; HttpOnly")));
        assertEquals(1, jar.loadForRequest(LOGIN).size());
        assertEquals("verified", jar.token("auth"));
    }

    @Test public void deletionWithoutSecureOrDomainRemovesTheCanonicalCookie() {
        SessionCookies jar = new SessionCookies();
        jar.saveFromResponse(LOGIN, Collections.singletonList(parse("auth=pending; Domain=vrchat.cloud; Path=/; Secure")));
        jar.saveFromResponse(LOGIN, Collections.singletonList(parse("auth=; Max-Age=0; Path=/")));
        assertTrue(jar.loadForRequest(LOGIN).isEmpty());
        assertNull(jar.token("auth"));
    }

    @Test public void neverAcceptsOrSendsSessionOnHttpOtherPortsOrOtherHosts() {
        SessionCookies jar = new SessionCookies();
        Cookie auth = parse("auth=synthetic; Path=/");
        for (String address : Arrays.asList("http://api.vrchat.cloud/api/1/auth/user", "https://api.vrchat.cloud:444/api/1/auth/user", "https://evil.example/api/1/auth/user", "https://pipeline.vrchat.cloud/")) {
            HttpUrl url = HttpUrl.get(address);
            assertFalse(jar.receive(url, Collections.singletonList(auth)));
            assertTrue(jar.loadForRequest(url).isEmpty());
        }
        jar.saveFromResponse(LOGIN, Collections.singletonList(auth));
        assertFalse(jar.loadForRequest(LOGIN).isEmpty());
        assertTrue(jar.loadForRequest(HttpUrl.get("https://api.vrchat.cloud.evil.example/")).isEmpty());
        assertTrue(jar.loadForRequest(HttpUrl.get("https://cloud.vrchat.com/")).isEmpty());
    }

    @Test public void rejectsUnrelatedNamesAndForeignCookieDomains() {
        SessionCookies jar = new SessionCookies();
        List<Cookie> invalid = Arrays.asList(parse("tracking=ignore; Path=/"),
            new Cookie.Builder().name("auth").value("foreign").domain("evil.example").path("/").build(),
            new Cookie.Builder().name("auth").value("suffix").domain("cloud").path("/").build());
        assertFalse(jar.receive(LOGIN, invalid));
        assertTrue(jar.snapshot().isEmpty());
    }

    @Test public void respectsCookiePathsAndPrioritizesMostSpecificPath() {
        SessionCookies jar = new SessionCookies();
        jar.saveFromResponse(LOGIN, Arrays.asList(parse("auth=root; Path=/"), parse("auth=specific; Path=/api/1/auth")));
        List<Cookie> verification = jar.loadForRequest(OTP);
        assertEquals(2, verification.size());
        assertEquals("specific", verification.get(0).value());
        List<Cookie> worlds = jar.loadForRequest(HttpUrl.get("https://api.vrchat.cloud/api/1/worlds"));
        assertEquals(1, worlds.size());
        assertEquals("root", worlds.get(0).value());
        assertEquals("specific", jar.token("auth"));
    }

    @Test public void expiredCookiesAreNeverRestoredOrSentAndLogoutClearsBothTokens() {
        AtomicLong now = new AtomicLong(1000);
        SessionCookies jar = new SessionCookies(now::get);
        jar.saveFromResponse(LOGIN, Arrays.asList(new Cookie.Builder().name("auth").value("expiring").hostOnlyDomain("api.vrchat.cloud").path("/").expiresAt(2000).build(), parse("twoFactorAuth=verified; Path=/")));
        assertEquals(2, jar.snapshot().size());
        now.set(2000);
        assertNull(jar.token("auth"));
        assertEquals(1, jar.loadForRequest(LOGIN).size());
        jar.clear();
        assertTrue(jar.snapshot().isEmpty());
        assertNull(jar.token("twoFactorAuth"));
    }

    @Test public void persistedCookieStringsRestoreTheCompleteVerifiedSession() {
        SessionCookies original = new SessionCookies();
        original.saveFromResponse(LOGIN, Arrays.asList(parse("auth=pending; Path=/; HttpOnly"), parse("twoFactorAuth=verified; Path=/; HttpOnly")));
        SessionCookies restored = new SessionCookies();
        List<Cookie> persisted = new ArrayList<>();
        for(Cookie cookie : original.snapshot()) persisted.add(parse(SessionCookies.ORIGIN,cookie.toString()));
        restored.receive(SessionCookies.ORIGIN,persisted);
        assertEquals(original.loadForRequest(LOGIN),restored.loadForRequest(LOGIN));
        assertEquals("pending",restored.token("auth"));
        assertEquals("verified",restored.token("twoFactorAuth"));
    }

    @Test public void emptyOrUnrelatedResponsesDoNotRequireSecurePersistence() {
        SessionCookies jar = new SessionCookies();
        assertFalse(jar.receive(LOGIN, Collections.emptyList()));
        assertFalse(jar.receive(LOGIN, Collections.singletonList(parse("unrelated=ignore; Path=/"))));
        assertTrue(jar.receive(LOGIN, Collections.singletonList(parse("auth=pending; Path=/"))));
        assertFalse(jar.receive(OTP, Collections.emptyList()));
        assertEquals("pending",jar.token("auth"));
    }
}
