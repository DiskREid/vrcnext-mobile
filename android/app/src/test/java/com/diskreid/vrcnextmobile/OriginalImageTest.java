package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.junit.Test;

public class OriginalImageTest {
    @Test public void originalBytesArePreservedWithoutAThumbnailConversion() throws Exception {
        byte[] original = { (byte)137, 'P', 'N', 'G', 13, 10, 26, 10, 1, 2, 3, 4 };
        byte[] result = OriginalImage.readBounded(new ByteArrayInputStream(original), original.length, 32);
        assertArrayEquals(original, result);
        assertEquals("image/png", ImageEndpoint.rasterMime(result, "image/png"));
    }
    @Test public void boundsBothDeclaredAndActuallyStreamedSizeIncludingUnknownLength() throws Exception {
        assertThrows(IOException.class, () -> OriginalImage.readBounded(new ByteArrayInputStream(new byte[5]), 5, 4));
        assertThrows(IOException.class, () -> OriginalImage.readBounded(new ByteArrayInputStream(new byte[5]), -1, 4));
        assertThrows(IOException.class, () -> OriginalImage.readBounded(new ByteArrayInputStream(new byte[5]), 1, 4));
        assertEquals(4, OriginalImage.readBounded(new ByteArrayInputStream(new byte[4]), -1, 4).length);
    }
    @Test public void refusesEmptyResponsesAndUnsuitableMimeTypes() {
        assertThrows(IOException.class, () -> OriginalImage.readBounded(new ByteArrayInputStream(new byte[0]), 0, 4));
        assertThrows(IllegalArgumentException.class, () -> OriginalImage.fileName("image", "text/html"));
    }
    @Test public void namesCannotEscapePicturesOrUseAnUntrustedExtension() {
        assertEquals("______photo.png", OriginalImage.fileName("../../photo.jpg", "image/png"));
        assertEquals("a.webp", OriginalImage.fileName("a", "image/webp"));
        assertEquals("VRCNext-image.gif", OriginalImage.fileName("", "image/gif"));
        assertTrue(OriginalImage.fileName("Скриншот", "image/jpeg").endsWith(".jpg"));
        assertTrue(OriginalImage.fileName("x".repeat(1000), "image/png").length() <= 84);
    }
}
