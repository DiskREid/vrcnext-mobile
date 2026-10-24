package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class ApiEndpointTest {
    @Test public void preservesEncodedSearchWithoutChangingOrigin() {
        okhttp3.HttpUrl url = ApiEndpoint.resolve("/worlds?search=cats%20%26%20dogs&n=20");
        assertEquals("https", url.scheme());
        assertEquals("api.vrchat.cloud", url.host());
        assertEquals("/api/1/worlds", url.encodedPath());
        assertEquals("cats & dogs", url.queryParameter("search"));
    }

    @Test public void blocksSessionTokenEndpointsButKeepsLoginAndTwoFactor() {
        assertThrows(IllegalArgumentException.class, () -> ApiEndpoint.resolve("/auth"));
        assertThrows(IllegalArgumentException.class, () -> ApiEndpoint.resolve("/auth/"));
        assertThrows(IllegalArgumentException.class, () -> ApiEndpoint.resolve("/%61uth"));
        assertThrows(IllegalArgumentException.class, () -> ApiEndpoint.resolve("/auth%2ftoken"));
        assertThrows(IllegalArgumentException.class, () -> ApiEndpoint.resolve("/auth/token"));
        assertEquals("/api/1/auth/user", ApiEndpoint.resolve("/auth/user").encodedPath());
        assertEquals("/api/1/auth/user/friends", ApiEndpoint.resolve("/auth/user/friends?offline=false").encodedPath());
        assertEquals("/api/1/auth/twofactorauth/totp/verify", ApiEndpoint.resolve("/auth/twofactorauth/totp/verify").encodedPath());
    }

    @Test public void rejectsExternalTargetsAndTraversal() {
        String[] bad = {"https://evil.example", "//evil.example/x", "/../../auth", "/%2e%2e/%2e%2e/auth",
            "/worlds#fragment", "/worlds\\evil", "/worlds\r\nHost:evil", "", null};
        for (String path : bad) assertThrows("Should reject " + path, IllegalArgumentException.class, () -> ApiEndpoint.resolve(path));
    }
}
