package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class OscPacketTest {
    @Test public void encodesNetworkOrderInt() throws Exception {
        byte[] expected = {'/','x',0,0,',','i',0,0,0,0,0,42};
        assertArrayEquals(expected, OscPacket.encode("/x", "i", 42));
    }

    @Test public void encodesFloatAndUtf8Padding() throws Exception {
        byte[] f = OscPacket.encode("/avatar/parameters/X", "f", .5);
        assertEquals(.5f, ByteBuffer.wrap(f, f.length - 4, 4).getFloat(), 0);
        byte[] text = OscPacket.encode("/chatbox/input", "s", "Привет");
        assertEquals(0, text.length % 4);
        assertTrue(new String(text, StandardCharsets.UTF_8).contains("Привет"));
    }

    @Test public void booleanHasNoPayload() throws Exception {
        assertArrayEquals(new byte[]{'/','x',0,0,',','T',0,0}, OscPacket.encode("/x", "T", null));
    }

    @Test public void chatboxIncludesSendAndSoundArguments() throws Exception {
        byte[] expected = {'/','c','h','a','t','b','o','x','/','i','n','p','u','t',0,0,
            ',','s','T','F',0,0,0,0,'H','i',0,0};
        assertArrayEquals(expected, OscPacket.chatbox("Hi", false));
        assertTrue(new String(OscPacket.chatbox("Hi", true), StandardCharsets.UTF_8).contains(",sTT"));
    }

    @Test public void rejectsMalformedValues() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> OscPacket.encode("bad", "i", 1));
        assertThrows(IllegalArgumentException.class, () -> OscPacket.encode("/x", "i", 1.5));
        assertThrows(IllegalArgumentException.class, () -> OscPacket.encode("/x", "f", Double.NaN));
        assertThrows(IllegalArgumentException.class, () -> OscPacket.encode("/x", "s", "bad\0text"));
        assertThrows(IllegalArgumentException.class, () -> OscPacket.chatbox(new String(new char[145]), false));
    }
}
