package com.diskreid.vrcnextmobile;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Small OSC 1.0 message encoder, independent of Android for packet-level verification. */
final class OscPacket {
    private OscPacket() {}

    static byte[] encode(String address, String type, Object value) throws IOException {
        if (address == null || !address.startsWith("/") || address.length() > 256 || address.indexOf('\0') >= 0)
            throw new IllegalArgumentException("Invalid OSC address");
        if (type == null || !(type.equals("s") || type.equals("f") || type.equals("i")
                || type.equals("T") || type.equals("F"))) throw new IllegalArgumentException("Invalid OSC type");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream stream = new DataOutputStream(bytes);
        writeString(stream, address);
        writeString(stream, "," + type);
        switch (type) {
            case "s":
                if (!(value instanceof String) || ((String) value).length() > 1024 || ((String) value).indexOf('\0') >= 0)
                    throw new IllegalArgumentException("Invalid OSC text");
                writeString(stream, (String) value);
                break;
            case "f":
                if (!(value instanceof Number) || (Float.isNaN(((Number) value).floatValue()) || Float.isInfinite(((Number) value).floatValue())))
                    throw new IllegalArgumentException("Invalid OSC float");
                stream.writeFloat(((Number) value).floatValue());
                break;
            case "i":
                if (!(value instanceof Number)) throw new IllegalArgumentException("Invalid OSC integer");
                double number = ((Number) value).doubleValue();
                if ((Double.isNaN(number) || Double.isInfinite(number)) || number != Math.rint(number) || number < Integer.MIN_VALUE || number > Integer.MAX_VALUE)
                    throw new IllegalArgumentException("Invalid OSC integer");
                stream.writeInt((int) number);
                break;
            default: break; // OSC boolean type tags have no payload.
        }
        return bytes.toByteArray();
    }

    static byte[] chatbox(String text, boolean sound) throws IOException {
        if (text == null || text.length() > 144 || text.indexOf('\0') >= 0)
            throw new IllegalArgumentException("Chatbox messages are limited to 144 characters");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream stream = new DataOutputStream(bytes);
        writeString(stream, "/chatbox/input");
        // VRChat expects string, send-immediately bool, play-notification bool. Booleans have no payload.
        writeString(stream, sound ? ",sTT" : ",sTF");
        writeString(stream, text);
        return bytes.toByteArray();
    }

    private static void writeString(DataOutputStream stream, String value) throws IOException {
        byte[] utf8 = value.getBytes(StandardCharsets.UTF_8);
        stream.write(utf8);
        int padding = 4 - (utf8.length % 4);
        for (int index = 0; index < padding; index++) stream.writeByte(0);
    }
}
