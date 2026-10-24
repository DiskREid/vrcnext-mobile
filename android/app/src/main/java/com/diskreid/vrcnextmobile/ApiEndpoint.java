package com.diskreid.vrcnextmobile;

import okhttp3.HttpUrl;

/** Prevent a WebView caller from turning the authenticated transport into an arbitrary HTTP proxy. */
final class ApiEndpoint {
    private ApiEndpoint() { }

    static String decodedPath(HttpUrl url) {
        StringBuilder decoded = new StringBuilder();
        for (String segment : url.pathSegments()) {
            if (segment.indexOf('/') >= 0 || segment.indexOf('\\') >= 0)
                throw new IllegalArgumentException("Ambiguous API path");
            decoded.append('/').append(segment);
        }
        return decoded.toString();
    }

    static HttpUrl resolve(String path) {
        if (path == null || !path.startsWith("/") || path.startsWith("//") || path.contains("\\")
                || path.contains("#") || path.length() > 8192) throw new IllegalArgumentException("Invalid API path");
        for (int index = 0; index < path.length(); index++) {
            if (path.charAt(index) < 32 || path.charAt(index) == 127) throw new IllegalArgumentException("Invalid API path");
        }
        HttpUrl url = HttpUrl.get("https://api.vrchat.cloud/api/1" + path);
        if (!url.isHttps() || !url.host().equals("api.vrchat.cloud") || url.port() != 443
                || !url.username().isEmpty() || !url.password().isEmpty() || !url.encodedPath().startsWith("/api/1/"))
            throw new IllegalArgumentException("Invalid API destination");
        String route = decodedPath(url);
        // GET /auth returns the raw session token in VRChat's response. Keep it native-only.
        // Only the current-user family and explicitly supported 2FA verification routes are needed.
        if ((route.equals("/api/1/auth") || route.startsWith("/api/1/auth/"))
                && !route.equals("/api/1/auth/user") && !route.startsWith("/api/1/auth/user/")
                && !route.equals("/api/1/auth/twofactorauth/totp/verify")
                && !route.equals("/api/1/auth/twofactorauth/emailotp/verify")
                && !route.equals("/api/1/auth/twofactorauth/otp/verify"))
            throw new IllegalArgumentException("This authentication route is native-only");
        return url;
    }
}
