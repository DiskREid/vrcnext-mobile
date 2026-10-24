package com.diskreid.vrcnextmobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import org.json.JSONArray;

/** Cookie values stay in native memory and Keystore-encrypted private storage. */
final class SecureCookieJar implements CookieJar {
    private static final String KEY_ALIAS = "vrcnext.mobile.session.v1";
    private static final String PREF_KEY = "encrypted_cookies";
    private static final HttpUrl ORIGIN = SessionCookies.ORIGIN;
    private final SharedPreferences preferences;
    private final SessionCookies cookies = new SessionCookies();

    SecureCookieJar(Context context) {
        preferences = context.getSharedPreferences("vrc_session_private", Context.MODE_PRIVATE);
        restore();
    }

    private SecretKey encryptionKey() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    private synchronized void restore() {
        try {
            String stored = preferences.getString(PREF_KEY, null);
            if (stored == null) return;
            String[] parts = stored.split(":", 2);
            if (parts.length != 2) throw new GeneralSecurityException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, encryptionKey(),
                    new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            byte[] cleartext = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            JSONArray values = new JSONArray(new String(cleartext, java.nio.charset.StandardCharsets.UTF_8));
            java.util.Arrays.fill(cleartext, (byte) 0);
            List<Cookie> restored = new ArrayList<>();
            for (int index = 0; index < values.length(); index++) {
                Cookie cookie = Cookie.parse(ORIGIN, values.getString(index));
                if (cookie != null) restored.add(cookie);
            }
            cookies.receive(ORIGIN, restored);
        } catch (Exception failure) {
            // Reinstall/invalidated Keystore key: require a fresh login, never fall back to plaintext.
            cookies.clear();
            preferences.edit().remove(PREF_KEY).commit();
            // An invalidated key cannot encrypt a new session. Drop only this app-specific key so
            // the next login can create a fresh one; never fall back to unencrypted storage.
            try {
                KeyStore store = KeyStore.getInstance("AndroidKeyStore");
                store.load(null);
                if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
            } catch (Exception ignored) { /* A later login reports unavailable secure storage. */ }
        }
    }

    @Override public synchronized void saveFromResponse(HttpUrl url, List<Cookie> incoming) {
        if (cookies.receive(url, incoming)) persist();
    }

    @Override public synchronized List<Cookie> loadForRequest(HttpUrl url) {
        return cookies.loadForRequest(url);
    }

    synchronized String token(String name) { return cookies.token(name); }

    private void persist() {
        try {
            JSONArray values = new JSONArray();
            for (Cookie cookie : cookies.snapshot()) values.put(cookie.toString());
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            byte[] encrypted = cipher.doFinal(values.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                    + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            if (!preferences.edit().putString(PREF_KEY, stored).commit()) throw new IOException();
        } catch (Exception failure) {
            throw new IllegalStateException("Encrypted session storage unavailable");
        }
    }

    synchronized void clear() {
        cookies.clear();
        if (!preferences.edit().remove(PREF_KEY).commit()) throw new IllegalStateException("Cannot clear session");
    }
}
