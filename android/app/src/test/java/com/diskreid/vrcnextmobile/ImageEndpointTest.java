package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class ImageEndpointTest {
    @Test public void allowsOnlyOfficialHttpsImageSources() {
        assertEquals("api.vrchat.cloud", ImageEndpoint.resolve("https://api.vrchat.cloud/api/1/file/file_abc/1/file").host());
        assertEquals("files.vrchat.cloud", ImageEndpoint.resolve("https://files.vrchat.cloud/file/test.png?signature=abc").host());
        assertEquals("assets.vrchat.com", ImageEndpoint.resolve("https://assets.vrchat.com/test.png").host());
    }

    @Test public void rejectsUntrustedHostsAndCredentialBearingUrls() {
        String[] bad = {"http://api.vrchat.cloud/api/1/file/a", "https://evil.example/a.png",
            "https://api.vrchat.cloud.evil.example/api/1/file/a", "https://user:pass@api.vrchat.cloud/api/1/file/a",
            "https://api.vrchat.cloud:8443/api/1/file/a", "https://api.vrchat.cloud/api/1/auth",
            "https://api.vrchat.cloud/api/1/file/../../auth", "file:///data/private", "data:image/png;base64,abcd"};
        for (String url : bad) assertThrows("Should reject " + url, IllegalArgumentException.class, () -> ImageEndpoint.resolve(url));
    }

    @Test public void rejectsNonImagePayloadsEvenIfMimeClaimsImage() {
        byte[] json = "{\"token\":\"redacted\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        assertFalse(ImageEndpoint.hasRasterSignature(json, "image/png"));
        assertFalse(ImageEndpoint.hasRasterSignature(json, "application/json"));
        byte[] png = {(byte)137,'P','N','G',13,10,26,10,0,0,0,0};
        assertTrue(ImageEndpoint.hasRasterSignature(png, "image/png"));
    }
}
