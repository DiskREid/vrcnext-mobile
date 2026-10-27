package com.diskreid.vrcnextmobile;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;

/** Exact file lookup, isolated from the authenticated VRChat transport. */
final class AvatarDatabaseEndpoint {
    private AvatarDatabaseEndpoint() { }

    static Request resolve(String fileId, String userAgent) {
        if (fileId == null || !fileId.matches("file_[A-Za-z0-9_-]{1,120}"))
            throw new IllegalArgumentException("Invalid avatar file ID");
        // The validated alphabet contains no JSON syntax or escape characters.
        String payload = "{\"file_ids\":[\"" + fileId + "\"]}";
        HttpUrl url = new HttpUrl.Builder().scheme("https").host("api.avtrdb.com")
                .addPathSegments("v3/avatar/resolve").build();
        return new Request.Builder().url(url).header("User-Agent", userAgent)
                .header("Accept", "application/json")
                .method("QUERY", RequestBody.create(payload, MediaType.get("application/json; charset=utf-8")))
                .build();
    }
}
