package com.diskreid.vrcnextmobile;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import okhttp3.HttpUrl;

/** Every image source and redirect is checked; no wildcard third-party download proxy. */
final class ImageEndpoint {
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList("api.vrchat.cloud", "vrchat.com",
            "api.vrchat.com", "cloud.vrchat.com", "files.vrchat.cloud", "file-variants.vrchat.com", "assets.vrchat.com"));
    private ImageEndpoint() { }

    static HttpUrl resolve(String source) {
        if (source == null || source.length() > 8192 || source.indexOf('\\') >= 0) throw new IllegalArgumentException();
        HttpUrl url = HttpUrl.get(source);
        if (!url.isHttps() || url.port() != 443 || !HOSTS.contains(url.host())
                || !url.username().isEmpty() || !url.password().isEmpty() || url.fragment() != null)
            throw new IllegalArgumentException("Untrusted image URL");
        if (url.host().equals("api.vrchat.cloud") || url.host().equals("vrchat.com") || url.host().equals("api.vrchat.com")) {
            String path = ApiEndpoint.decodedPath(url);
            if (!path.startsWith("/api/1/file/") && !path.startsWith("/api/1/image/"))
                throw new IllegalArgumentException("Not an image API path");
            // Legacy VRChat image URLs use these aliases. Authenticate only at the canonical API host.
            if (!url.host().equals("api.vrchat.cloud")) url = url.newBuilder().host("api.vrchat.cloud").build();
        }
        return url;
    }

    static String rasterMime(byte[] bytes, String declared) {
        if (hasRasterSignature(bytes, declared)) return declared;
        if (declared.isEmpty() || declared.equals("application/octet-stream")) {
            for (String mime : Arrays.asList("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"))
                if (hasRasterSignature(bytes, mime)) return mime;
        }
        throw new IllegalArgumentException("Not a supported raster image");
    }

    static boolean hasRasterSignature(byte[] bytes, String mime) {
        if (bytes.length < 12) return false;
        switch (mime) {
            case "image/png": return bytes[0] == (byte) 137 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G'
                    && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10;
            case "image/jpeg": return bytes[0] == (byte) 255 && bytes[1] == (byte) 216 && bytes[2] == (byte) 255;
            case "image/gif": return ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a");
            case "image/webp": return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP");
            case "image/avif": return ascii(bytes, 4, "ftyp") && (ascii(bytes, 8, "avif") || ascii(bytes, 8, "avis"));
            default: return false;
        }
    }

    private static boolean ascii(byte[] bytes, int offset, String text) {
        if (offset + text.length() > bytes.length) return false;
        for (int index = 0; index < text.length(); index++) if (bytes[offset + index] != text.charAt(index)) return false;
        return true;
    }
}
