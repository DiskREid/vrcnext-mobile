package com.diskreid.vrcnextmobile;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

final class GalleryImageStore {
    private GalleryImageStore() { }

    static String save(Context context, byte[] bytes, String mime, String requested) throws IOException {
        String fileName = OriginalImage.fileName(requested, mime);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mime);
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/VRCNext");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("Gallery is unavailable");
            try {
                try (OutputStream output = context.getContentResolver().openOutputStream(uri, "w")) {
                    if (output == null) throw new IOException("Gallery is unavailable");
                    output.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                if (context.getContentResolver().update(uri, values, null, null) == 0) throw new IOException("Gallery publish failed");
                return fileName;
            } catch (Exception failure) {
                context.getContentResolver().delete(uri, null, null);
                throw new IOException("Could not save in gallery", failure);
            }
        }
        // Android 8/9: permission is checked by the plugin before writing a public Pictures file.
        File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "VRCNext");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Pictures directory unavailable");
        int dot = fileName.lastIndexOf('.');
        File destination = File.createTempFile("VRCNext_" + fileName.substring(0, dot) + "_", fileName.substring(dot), directory);
        try {
            try (FileOutputStream output = new FileOutputStream(destination)) { output.write(bytes); }
            MediaScannerConnection.scanFile(context, new String[] { destination.getAbsolutePath() }, new String[] { mime }, null);
            return destination.getName();
        } catch (Exception failure) {
            if (!destination.delete()) destination.deleteOnExit();
            throw new IOException("Could not save in Pictures", failure);
        }
    }
}
