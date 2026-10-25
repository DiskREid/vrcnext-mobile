package com.diskreid.vrcnextmobile;

import android.content.ActivityNotFoundException;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.util.LruCache;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import java.io.OutputStream;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Native-only VRChat transport: no cookies or pipeline tokens cross the WebView boundary. */
@CapacitorPlugin(name = "VrcNative")
public class VrcNativePlugin extends Plugin {
    private static final String USER_AGENT = "Mobile-VRCNext/0.2.2 (https://github.com/DiskREid/vrcnext-mobile/issues)";
    private static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_IMAGE_BYTES = 12 * 1024 * 1024;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final Set<String> METHODS = new HashSet<>(Arrays.asList("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"));
    private static final Set<String> IMAGE_TAGS = new HashSet<>(Arrays.asList("gallery", "icon", "emoji", "sticker"));
    private static final Set<String> IMAGE_TYPES = new HashSet<>(Arrays.asList("image/png", "image/jpeg", "image/gif", "image/webp"));
    private final LifecycleTasks tasks = new LifecycleTasks();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService imageIo = Executors.newFixedThreadPool(2);
    private final Object imageTimingLock = new Object();
    private long nextImageRequestAt;
    private final LruCache<String, String> imageCache = new LruCache<String, String>(8 * 1024 * 1024) {
        @Override protected int sizeOf(String key, String dataUrl) { return dataUrl.length() * 2; }
    };
    private final ScheduledExecutorService socketScheduler = Executors.newSingleThreadScheduledExecutor();
    private final AtomicInteger sessionGeneration = new AtomicInteger();
    private final AtomicInteger pipelineRequests = new AtomicInteger();
    private SecureCookieJar cookies;
    private OkHttpClient http;
    private OkHttpClient publicDbHttp;
    private long nextRequestAt;
    private volatile long cooldownUntil;
    private volatile long dbCooldownUntil;
    private final Object socketLock = new Object();
    private WebSocket socket;
    private boolean pipelineWanted;
    private boolean paused;
    private volatile boolean destroyed;
    private int socketGeneration;
    private int reconnectAttempts;

    @Override public void load() {
        cookies = new SecureCookieJar(getContext());
        http = new OkHttpClient.Builder().cookieJar(cookies)
                .followRedirects(false).followSslRedirects(false)
                .connectTimeout(20, TimeUnit.SECONDS).readTimeout(35, TimeUnit.SECONDS)
                .callTimeout(45, TimeUnit.SECONDS).pingInterval(30, TimeUnit.SECONDS)
                .retryOnConnectionFailure(false).build();
        publicDbHttp = http.newBuilder().cookieJar(okhttp3.CookieJar.NO_COOKIES).build();
    }

    @PluginMethod public void request(PluginCall call) {
        try {
            String path = call.getString("path", "");
            String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
            String authorization = call.getString("authorization");
            String body = call.getString("body");
            HttpUrl url = apiUrl(path);
            if (!METHODS.contains(method)) throw new IllegalArgumentException("Unsupported HTTP method");
            if (authorization != null && (!method.equals("GET") || !url.encodedPath().equals("/api/1/auth/user")
                    || url.query() != null || !authorization.matches("Basic [A-Za-z0-9+/=]{1,8192}")))
                throw new IllegalArgumentException("Authorization is allowed only for login");
            if (body != null) {
                if (body.length() > 1024 * 1024) throw new IllegalArgumentException("Request body too large");
                new JSONTokener(body).nextValue();
                if (method.equals("GET") || method.equals("HEAD")) throw new IllegalArgumentException("This method cannot have a body");
            }
            RequestBody requestBody = body == null ? null : RequestBody.create(body, JSON);
            if (requestBody == null && (method.equals("POST") || method.equals("PUT") || method.equals("PATCH")))
                requestBody = RequestBody.create("{}", JSON);
            Request.Builder builder = new Request.Builder().url(url).header("User-Agent", USER_AGENT)
                    .header("Accept", "application/json").method(method, requestBody);
            if (authorization != null) {
                builder.header("Authorization", authorization);
                sessionGeneration.incrementAndGet();
                imageCache.evictAll();
                disconnectSocket(true);
                http.dispatcher().cancelAll();
            }
            execute(call, builder.build());
        } catch (Exception failure) {
            reject(call, "Invalid API request", "INVALID_ARGUMENT");
        }
    }

    private void release(PluginCall call) {
        try { if (getBridge() != null) call.release(getBridge()); }
        catch (RuntimeException retiredBridge) { /* No WebView remains to receive this call. */ }
    }

    private void reply(PluginCall call, Runnable response) {
        if (tasks.isClosed()) { release(call); return; }
        try { response.run(); }
        catch (RuntimeException retiredBridge) { release(call); }
    }

    private void resolve(PluginCall call) { reply(call, call::resolve); }
    private void resolve(PluginCall call, JSObject data) { reply(call, () -> call.resolve(data)); }
    private void reject(PluginCall call, String message, String code) { reply(call, () -> call.reject(message, code)); }

    private void submit(Executor executor, PluginCall call, Runnable work) {
        tasks.execute(executor, work, () -> {
            if (tasks.isClosed()) release(call);
            else reject(call, "This screen is no longer available", "PLUGIN_CANCELLED");
        });
    }

    @PluginMethod public void sessionState(PluginCall call) {
        if (tasks.isClosed()) { release(call); return; }
        resolve(call, new JSObject().put("hasAuth", cookies != null && cookies.token("auth") != null));
    }

    @PluginMethod public void screenProtection(PluginCall call) {
        if (tasks.isClosed()) { release(call); return; }
        resolve(call, new JSObject().put("enabled", ScreenProtection.isEnabled(getContext())));
    }

    @PluginMethod public void setScreenProtection(PluginCall call) {
        if (tasks.isClosed()) { release(call); return; }
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) { reject(call, "An enabled value is required", "INVALID_ARGUMENT"); return; }
        getActivity().runOnUiThread(() -> {
            if (tasks.isClosed()) { release(call); return; }
            try {
                ScreenProtection.setEnabled(getActivity(), enabled);
                resolve(call, new JSObject().put("enabled", ScreenProtection.isEnabled(getContext())));
            } catch (RuntimeException failure) {
                reject(call, "Could not change screenshot protection", "SCREEN_PROTECTION_ERROR");
            }
        });
    }

    private HttpUrl apiUrl(String path) { return ApiEndpoint.resolve(path); }

    private void execute(PluginCall call, Request request) { execute(call, request, http); }

    private void execute(PluginCall call, Request request, OkHttpClient client) {
        final boolean publicDatabase = client == publicDbHttp;
        final int generation = sessionGeneration.get();
        submit(io, call, () -> {
            if (generation != sessionGeneration.get() || destroyed) {
                reject(call, "Session changed", "SESSION_CHANGED");
                return;
            }
            try {
                if (request.header("Authorization") != null) cookies.clear();
                long remaining = (publicDatabase ? dbCooldownUntil : cooldownUntil) - System.currentTimeMillis();
                if (remaining > 0) {
                    JSObject result = new JSObject().put("status", 429).put("retryAfter", (int) Math.ceil(remaining / 1000.0))
                            .put("data", new JSObject().put("error", new JSObject().put("message", "VRChat rate limit; try again later")));
                    resolve(call, result);
                    return;
                }
                long wait = nextRequestAt - System.currentTimeMillis();
                if (wait > 0) Thread.sleep(wait);
                if (generation != sessionGeneration.get() || destroyed) {
                    reject(call, "Session changed", "SESSION_CHANGED");
                    return;
                }
                nextRequestAt = System.currentTimeMillis() + 350;
                try (Response response = client.newCall(request).execute()) {
                    JSObject result = new JSObject().put("status", response.code());
                    if (response.code() == 429) {
                        long retryMs = retryDelay(response.header("Retry-After"));
                        long until = retryMs > Long.MAX_VALUE - System.currentTimeMillis() ? Long.MAX_VALUE : System.currentTimeMillis() + retryMs;
                        if (publicDatabase) dbCooldownUntil = Math.max(dbCooldownUntil, until);
                        else cooldownUntil = Math.max(cooldownUntil, until);
                        result.put("retryAfter", (int) Math.ceil(retryMs / 1000.0));
                    }
                    ResponseBody responseBody = response.body();
                    String text = "";
                    if (responseBody != null) {
                        if (responseBody.contentLength() > MAX_RESPONSE_BYTES || responseBody.source().request(MAX_RESPONSE_BYTES + 1L))
                            throw new IOException("Response exceeds size limit");
                        text = responseBody.string();
                    }
                    Object data = JSONObject.NULL;
                    if (!text.trim().isEmpty()) {
                        try { data = new JSONTokener(text).nextValue(); }
                        catch (Exception invalid) {
                            data = new JSObject().put("error", new JSObject().put("message", "VRChat returned an unreadable response"));
                        }
                    }
                    result.put("data", data);
                    if (generation != sessionGeneration.get()) reject(call, "Session changed", "SESSION_CHANGED");
                    else resolve(call, result);
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                reject(call, "Request cancelled", "REQUEST_CANCELLED");
            } catch (Exception failure) {
                // Do not expose exception messages: request URLs/headers can contain credentials.
                reject(call, "Could not reach VRChat securely; check your connection and try again", "NETWORK_ERROR");
            }
        });
    }

    private long retryDelay(String header) {
        if (header == null) return 60000L;
        try {
            long seconds = Long.parseLong(header.trim());
            if (seconds >= 0 && seconds <= Long.MAX_VALUE / 1000L) return Math.max(1000L, seconds * 1000L);
        } catch (NumberFormatException ignored) { }
        try {
            SimpleDateFormat parser = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
            parser.setTimeZone(TimeZone.getTimeZone("GMT"));
            Date date = parser.parse(header);
            if (date != null) return Math.max(1000L, date.getTime() - System.currentTimeMillis());
        } catch (Exception ignored) { }
        return 60000L;
    }

    @PluginMethod public void searchPublicAvatars(PluginCall call) {
        String query = call.getString("query", "").trim();
        int page = call.getInt("page", 0);
        if (query.isEmpty() || query.length() > 100 || page < 0 || page > 10000) {
            reject(call, "Enter an avatar name up to 100 characters", "INVALID_ARGUMENT");
            return;
        }
        HttpUrl url = new HttpUrl.Builder().scheme("https").host("api.avtrdb.com")
                .addPathSegments("v2/avatar/search").addQueryParameter("query", query)
                .addQueryParameter("limit", "20").addQueryParameter("page", String.valueOf(page)).build();
        execute(call, new Request.Builder().url(url).header("User-Agent", USER_AGENT)
                .header("Accept", "application/json").get().build(), publicDbHttp);
    }

    @PluginMethod public void uploadImage(PluginCall call) {
        try {
            String tag = call.getString("tag", "gallery");
            String data = call.getString("data", "");
            String mime = call.getString("mimeType", "image/png");
            String fileName = call.getString("fileName", "upload.png");
            if (!IMAGE_TAGS.contains(tag) || !IMAGE_TYPES.contains(mime) || data.length() > MAX_IMAGE_BYTES * 4L / 3L + 8L)
                throw new IllegalArgumentException();
            byte[] image = Base64.decode(data, Base64.DEFAULT);
            if (image.length == 0 || image.length > MAX_IMAGE_BYTES) throw new IllegalArgumentException();
            if (!fileName.matches("[A-Za-z0-9_.-]{1,128}")) fileName = "upload.png";
            RequestBody upload = new MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("tag", tag)
                    .addFormDataPart("file", fileName, RequestBody.create(image, MediaType.get(mime))).build();
            execute(call, new Request.Builder().url(apiUrl("/file/image")).header("User-Agent", USER_AGENT)
                    .header("Accept", "application/json").post(upload).build());
        } catch (Exception failure) {
            reject(call, "Choose a PNG, JPEG, GIF or WebP image up to 12 MB", "INVALID_IMAGE");
        }
    }

    @PluginMethod public void loadImage(PluginCall call) {
        final HttpUrl source;
        try { source = ImageEndpoint.resolve(call.getString("url", "")); }
        catch (Exception invalid) { reject(call, "This image source is not supported", "INVALID_IMAGE_URL"); return; }
        final int generation = sessionGeneration.get();
        final String cacheKey = generation + ":" + source;
        String cached = imageCache.get(cacheKey);
        if (cached != null) { resolve(call, new JSObject().put("dataUrl", cached)); return; }
        submit(imageIo, call, () -> {
            try {
                HttpUrl target = source;
                for (int redirect = 0; redirect <= 5; redirect++) {
                    if (destroyed || generation != sessionGeneration.get()) throw new IOException();
                    boolean apiHost = target.host().equals("api.vrchat.cloud");
                    if (apiHost) {
                        synchronized (imageTimingLock) {
                            if (cooldownUntil > System.currentTimeMillis()) throw new IOException();
                            long wait = nextImageRequestAt - System.currentTimeMillis();
                            if (wait > 0) Thread.sleep(wait);
                            if (cooldownUntil > System.currentTimeMillis()) throw new IOException();
                            nextImageRequestAt = System.currentTimeMillis() + 350;
                        }
                    }
                    if (destroyed || generation != sessionGeneration.get()) throw new IOException();
                    // A fresh request for each validated hop. No Authorization header is forwarded.
                    Request request = new Request.Builder().url(target).header("User-Agent", USER_AGENT)
                            .header("Accept", "image/webp,image/png,image/jpeg,image/gif").get().build();
                    OkHttpClient client = apiHost ? http : publicDbHttp;
                    try (Response response = client.newCall(request).execute()) {
                        if (response.code() >= 300 && response.code() < 400) {
                            String location = response.header("Location");
                            HttpUrl next = location == null ? null : target.resolve(location);
                            if (next == null || redirect == 5) throw new IOException();
                            target = ImageEndpoint.resolve(next.toString());
                            continue;
                        }
                        if (response.code() == 429 && apiHost) {
                            long retryMs = retryDelay(response.header("Retry-After"));
                            long now = System.currentTimeMillis();
                            long until = retryMs > Long.MAX_VALUE - now ? Long.MAX_VALUE : now + retryMs;
                            cooldownUntil = Math.max(cooldownUntil, until);
                        }
                        if (!response.isSuccessful() || response.body() == null) throw new IOException();
                        ResponseBody body = response.body();
                        final int limit = 5 * 1024 * 1024;
                        if (body.contentLength() > limit || body.source().request(limit + 1L)) throw new IOException();
                        String mime = response.header("Content-Type", "").split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
                        byte[] bytes = body.bytes();
                        if (!ImageEndpoint.hasRasterSignature(bytes, mime)) throw new IOException();
                        android.graphics.BitmapFactory.Options dimensions = new android.graphics.BitmapFactory.Options();
                        dimensions.inJustDecodeBounds = true;
                        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, dimensions);
                        if (dimensions.outWidth <= 0 || dimensions.outHeight <= 0 || dimensions.outWidth > 8192 || dimensions.outHeight > 8192
                                || (long) dimensions.outWidth * dimensions.outHeight > 32000000L) throw new IOException();
                        if (!mime.equals("image/gif")) {
                            // This bridge returns previews; retain the original URL for opening/downloading.
                            // Sample before decode so large photos never allocate their full-resolution bitmap.
                            int longest = Math.max(dimensions.outWidth, dimensions.outHeight);
                            int sample = 1;
                            while (longest / (sample * 2) >= 1024) sample *= 2;
                            dimensions.inJustDecodeBounds = false;
                            dimensions.inSampleSize = sample;
                            dimensions.inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888;
                            android.graphics.Bitmap decoded = null;
                            android.graphics.Bitmap preview = null;
                            try {
                                decoded = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, dimensions);
                                if (decoded == null) throw new IOException();
                                longest = Math.max(decoded.getWidth(), decoded.getHeight());
                                preview = decoded;
                                if (longest > 1024) {
                                    int width = Math.max(1, (int) Math.round(decoded.getWidth() * (1024.0 / longest)));
                                    int height = Math.max(1, (int) Math.round(decoded.getHeight() * (1024.0 / longest)));
                                    preview = android.graphics.Bitmap.createScaledBitmap(decoded, width, height, true);
                                }
                                boolean alpha = preview.hasAlpha();
                                ByteArrayOutputStream encoded = new ByteArrayOutputStream();
                                if (!preview.compress(alpha ? android.graphics.Bitmap.CompressFormat.PNG
                                        : android.graphics.Bitmap.CompressFormat.JPEG, 85, encoded)) throw new IOException();
                                bytes = encoded.toByteArray();
                                mime = alpha ? "image/png" : "image/jpeg";
                            } finally {
                                if (preview != null && preview != decoded) preview.recycle();
                                if (decoded != null) decoded.recycle();
                            }
                        }
                        String dataUrl = "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
                        if (destroyed || generation != sessionGeneration.get()) throw new IOException();
                        imageCache.put(cacheKey, dataUrl);
                        resolve(call, new JSObject().put("dataUrl", dataUrl));
                        return;
                    }
                }
                throw new IOException();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                reject(call, "Image request cancelled", "REQUEST_CANCELLED");
            } catch (Exception failure) {
                reject(call, "Could not load this image securely", "IMAGE_DOWNLOAD_FAILED");
            }
        });
    }

    @PluginMethod public void clearSession(PluginCall call) {
        sessionGeneration.incrementAndGet();
        imageCache.evictAll();
        disconnectSocket(true);
        http.dispatcher().cancelAll();
        submit(io, call, () -> {
            try { cookies.clear(); resolve(call); }
            catch (Exception failure) { reject(call, "Could not clear encrypted session", "SESSION_STORAGE_ERROR"); }
        });
    }

    @PluginMethod public void connectPipeline(PluginCall call) {
        final int session = sessionGeneration.get();
        final int intent = pipelineRequests.incrementAndGet();
        submit(io, call, () -> {
            synchronized (socketLock) {
                // Logout/disconnect can arrive while this call is queued behind an API request.
                if (session != sessionGeneration.get() || intent != pipelineRequests.get() || destroyed) {
                    resolve(call);
                    return;
                }
                if (cookies.token("auth") == null) { reject(call, "Sign in first", "NO_SESSION"); return; }
                pipelineWanted = true;
                reconnectAttempts = 0;
                if (socket == null && !paused) startSocket();
            }
            resolve(call);
        });
    }

    @PluginMethod public void disconnectPipeline(PluginCall call) {
        disconnectSocket(true);
        resolve(call);
    }

    private void startSocket() {
        // Caller holds socketLock; generation makes late callbacks from previous sockets harmless.
        final int generation = ++socketGeneration;
        String auth = cookies.token("auth");
        if (auth == null || !pipelineWanted || paused || destroyed) return;
        HttpUrl url = new HttpUrl.Builder().scheme("https").host("pipeline.vrchat.cloud")
                .addQueryParameter("authToken", auth).build();
        Request.Builder builder = new Request.Builder().url(url).header("User-Agent", USER_AGENT);
        String cookieHeader = "auth=" + auth;
        String twoFactor = cookies.token("twoFactorAuth");
        if (twoFactor != null) cookieHeader += "; twoFactorAuth=" + twoFactor;
        builder.header("Cookie", cookieHeader);
        connection("connecting");
        socket = http.newWebSocket(builder.build(), new WebSocketListener() {
            @Override public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                synchronized (socketLock) {
                    if (generation != socketGeneration) { webSocket.close(1000, "Session changed"); return; }
                    reconnectAttempts = 0;
                    connection("connected");
                }
            }
            @Override public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                synchronized (socketLock) { if (generation != socketGeneration) return; }
                if (text.length() > 1024 * 1024) return;
                try {
                    JSONObject envelope = new JSONObject(text);
                    String type = envelope.optString("type", "");
                    if (type.isEmpty() || type.length() > 128) return;
                    Object content = envelope.opt("content");
                    if (content instanceof String) {
                        try { content = new JSONTokener((String) content).nextValue(); }
                        catch (Exception invalid) { content = JSONObject.NULL; }
                    }
                    synchronized (socketLock) {
                        if (generation == socketGeneration && !tasks.isClosed())
                            notifyListeners("pipeline", new JSObject().put("type", type).put("content", content == null ? JSONObject.NULL : content));
                    }
                } catch (Exception ignored) { }
            }
            @Override public void onClosing(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                webSocket.close(code, null);
            }
            @Override public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                socketEnded(generation, false);
            }
            @Override public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable error, Response response) {
                if (response != null) response.close();
                socketEnded(generation, response != null && (response.code() == 401 || response.code() == 403));
            }
        });
    }

    private void socketEnded(int generation, boolean expired) {
        synchronized (socketLock) {
            if (generation != socketGeneration) return;
            socket = null;
            connection(expired ? "expired" : "disconnected");
            if (expired) { pipelineWanted = false; return; }
            if (!pipelineWanted || paused || destroyed) return;
            long delay = Math.min(60L, 1L << Math.min(++reconnectAttempts, 6));
            tasks.schedule(socketScheduler, () -> {
                synchronized (socketLock) {
                    if (generation == socketGeneration && pipelineWanted && !paused && !destroyed && socket == null) startSocket();
                }
            }, delay, TimeUnit.SECONDS);
        }
    }

    private void disconnectSocket(boolean forgetIntent) {
        synchronized (socketLock) {
            if (forgetIntent) {
                pipelineRequests.incrementAndGet();
                pipelineWanted = false;
            }
            ++socketGeneration;
            if (socket != null) { socket.close(1000, "Client paused"); socket.cancel(); socket = null; }
            connection("disconnected");
        }
    }

    private void connection(String state) {
        if (!tasks.isClosed()) notifyListeners("connection", new JSObject().put("state", state));
    }

    @Override protected void handleOnPause() {
        synchronized (socketLock) { paused = true; }
        disconnectSocket(false);
    }

    @Override protected void handleOnResume() {
        synchronized (socketLock) {
            paused = false;
            if (pipelineWanted && socket == null && !destroyed) startSocket();
        }
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        tasks.close();
        disconnectSocket(true);
        if (http != null) { http.dispatcher().cancelAll(); http.connectionPool().evictAll(); }
        io.shutdownNow();
        imageIo.shutdownNow();
        imageCache.evictAll();
        socketScheduler.shutdownNow();
    }

    @PluginMethod public void openLink(PluginCall call) {
        if (tasks.isClosed()) { release(call); return; }
        try {
            Uri uri = Uri.parse(call.getString("url", ""));
            String host = uri.getHost();
            if (!"https".equals(uri.getScheme()) || host == null || host.isEmpty() || uri.getUserInfo() != null
                    || (uri.getPort() != -1 && uri.getPort() != 443) || host.equals("localhost") || host.endsWith(".localhost"))
                throw new IllegalArgumentException();
            getActivity().runOnUiThread(() -> {
                if (tasks.isClosed()) { release(call); return; }
                try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri)); resolve(call); }
                catch (ActivityNotFoundException failure) { reject(call, "No browser is available", "BROWSER_NOT_INSTALLED"); }
            });
        } catch (Exception failure) { reject(call, "Only HTTPS web links can be opened", "INVALID_URL"); }
    }

    @PluginMethod public void copyText(PluginCall call) {
        if (tasks.isClosed()) { release(call); return; }
        String text = call.getString("text", "");
        if (text.length() > 128 * 1024) { reject(call, "Text too large; export a file instead", "TOO_LARGE"); return; }
        getActivity().runOnUiThread(() -> {
            if (tasks.isClosed()) { release(call); return; }
            try {
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null) throw new IllegalStateException();
                clipboard.setPrimaryClip(ClipData.newPlainText("VRCNext Mobile", text));
                resolve(call);
            } catch (RuntimeException failure) { reject(call, "Could not copy text", "CLIPBOARD_ERROR"); }
        });
    }

    @PluginMethod public void exportJson(PluginCall call) {
        if (tasks.isClosed()) { release(call); return; }
        String json = call.getString("json", "");
        try {
            if (json.length() > 2 * 1024 * 1024) throw new IllegalArgumentException();
            Object value = new JSONTokener(json).nextValue();
            if (!(value instanceof JSONObject) && !(value instanceof org.json.JSONArray)) throw new IllegalArgumentException();
            String fileName = call.getString("fileName", "VRCNext-data.json").replaceAll("[^a-zA-Z0-9_.-]", "_");
            if (fileName.length() > 120) fileName = fileName.substring(0, 120);
            if (!fileName.endsWith(".json")) fileName += ".json";
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json").putExtra(Intent.EXTRA_TITLE, fileName);
            getActivity().runOnUiThread(() -> {
                if (tasks.isClosed()) { release(call); return; }
                try { startActivityForResult(call, intent, "jsonDestination"); }
                catch (ActivityNotFoundException failure) { reject(call, "No document picker is available", "PICKER_UNAVAILABLE"); }
                catch (RuntimeException failure) { reject(call, "Could not open document picker", "EXPORT_FAILED"); }
            });
        } catch (ActivityNotFoundException failure) { reject(call, "No document picker is available", "PICKER_UNAVAILABLE"); }
        catch (Exception failure) { reject(call, "Invalid JSON export", "INVALID_ARGUMENT"); }
    }

    @ActivityCallback private void jsonDestination(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            resolve(call, new JSObject().put("saved", false)); return;
        }
        Uri uri = result.getData().getData();
        if (!"content".equals(uri.getScheme())) { reject(call, "Invalid document destination", "INVALID_DESTINATION"); return; }
        submit(io, call, () -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IOException();
                output.write(call.getString("json", "{}").getBytes(StandardCharsets.UTF_8));
                resolve(call, new JSObject().put("saved", true));
            } catch (Exception failure) { reject(call, "Could not save JSON document", "EXPORT_FAILED"); }
        });
    }
}
