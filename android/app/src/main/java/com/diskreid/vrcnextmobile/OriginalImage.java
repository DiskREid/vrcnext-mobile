package com.diskreid.vrcnextmobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Original downloads never pass through preview scaling or the JavaScript bridge. */
final class OriginalImage {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    private OriginalImage() { }

    static byte[] readBounded(InputStream input, long declared, int limit) throws IOException {
        if (declared > limit) throw new IOException("Image is too large");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int size = 0, count;
        while ((count = input.read(buffer)) != -1) {
            size += count;
            if (size > limit) throw new IOException("Image is too large");
            output.write(buffer, 0, count);
        }
        if (size == 0) throw new IOException("Empty image");
        return output.toByteArray();
    }

    static String fileName(String requested, String mime) {
        String extension;
        switch (mime) {
            case "image/png": extension = ".png"; break;
            case "image/jpeg": extension = ".jpg"; break;
            case "image/gif": extension = ".gif"; break;
            case "image/webp": extension = ".webp"; break;
            case "image/avif": extension = ".avif"; break;
            default: throw new IllegalArgumentException("Unsupported image type");
        }
        String base = requested == null ? "" : requested.replaceFirst("(?i)\\.(png|jpe?g|gif|webp|avif)$", "");
        base = base.replaceAll("[^\\p{L}\\p{N}_-]", "_");
        if (base.length() > 80) base = base.substring(0, 80);
        if (base.isEmpty()) base = "VRCNext-image";
        return base + extension;
    }
}
