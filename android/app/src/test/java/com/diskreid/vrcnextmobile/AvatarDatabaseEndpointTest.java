package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import okhttp3.Request;
import okio.Buffer;
import org.junit.Test;

public class AvatarDatabaseEndpointTest {
    @Test public void usesExactPcQueryMethodAndSingleFilePayloadWithoutVrchatCredentials() throws Exception {
        String fileId = "file_22222222-2222-4222-8222-222222222222";
        Request request = AvatarDatabaseEndpoint.resolve(fileId, "Mobile-VRCNext/test");
        assertEquals("https://api.avtrdb.com/v3/avatar/resolve", request.url().toString());
        assertEquals("QUERY", request.method());
        assertEquals("application/json", request.header("Accept"));
        assertEquals("Mobile-VRCNext/test", request.header("User-Agent"));
        assertNull(request.header("Authorization"));
        assertNull(request.header("Cookie"));
        assertNull(request.url().query());
        assertEquals("application/json; charset=utf-8", request.body().contentType().toString());
        Buffer body = new Buffer();
        request.body().writeTo(body);
        assertEquals("{\"file_ids\":[\"" + fileId + "\"]}", body.readUtf8());
    }

    @Test public void rejectsUrlsJsonInjectionTraversalAndUnboundedIds() {
        String[] invalid = {null, "", "file_", "https://evil.example", "file_../auth", "file_x?auth=secret",
                "file_x\"}", "file_x\n", "file_" + new String(new char[121]).replace('\0', 'x')};
        for (String id : invalid)
            assertThrows("Should reject " + id, IllegalArgumentException.class,
                    () -> AvatarDatabaseEndpoint.resolve(id, "Mobile-VRCNext/test"));
    }
}
