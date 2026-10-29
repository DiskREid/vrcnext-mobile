package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/** Verify the resources Android resolves before MainActivity or the web UI can run. */
public class SplashResourcesTest {
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";

    private Path resources() {
        Path app = Paths.get("src/main/res");
        if (!Files.isDirectory(app)) app = Paths.get("android/app/src/main/res");
        return app;
    }

    private Element parse(Path path) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(path.toFile()).getDocumentElement();
    }

    private Element launchTheme(String folder) throws Exception {
        NodeList styles = parse(resources().resolve(folder + "/styles.xml")).getElementsByTagName("style");
        for (int i = 0; i < styles.getLength(); i++) {
            Element style = (Element) styles.item(i);
            if ("AppTheme.NoActionBarLaunch".equals(style.getAttribute("name"))) return style;
        }
        throw new AssertionError("Missing launch theme in " + folder);
    }

    private String item(Element style, String name) {
        NodeList items = style.getElementsByTagName("item");
        for (int i = 0; i < items.getLength(); i++) {
            Element item = (Element) items.item(i);
            if (name.equals(item.getAttribute("name"))) return item.getTextContent().trim();
        }
        throw new AssertionError("Missing launch attribute " + name);
    }

    @Test public void olderAndroidLaunchWindowUsesNewLogoBeforeTheWebViewExists() throws Exception {
        Element style = launchTheme("values");
        assertEquals("Theme.SplashScreen", style.getAttribute("parent"));
        assertEquals("@drawable/splash_brand", item(style, "windowSplashScreenAnimatedIcon"));
        assertEquals("@color/vrcn_bg", item(style, "windowSplashScreenBackground"));
        assertEquals("@style/AppTheme.NoActionBar", item(style, "postSplashScreenTheme"));
    }

    @Test public void compatibilitySplashReferencesTheSameNewArtworkAsTheStandardLauncher() throws Exception {
        Element inset = parse(resources().resolve("drawable/splash_brand.xml"));
        assertEquals("inset", inset.getTagName());
        assertEquals("@drawable/launcher_standard", inset.getAttributeNS(ANDROID, "drawable"));
        assertEquals("16.67%", inset.getAttributeNS(ANDROID, "inset"));
        Element icon = parse(resources().resolve("mipmap-anydpi-v26/ic_launcher.xml"));
        Element foreground = (Element) icon.getElementsByTagName("inset").item(0);
        assertEquals(foreground.getAttributeNS(ANDROID, "drawable"), inset.getAttributeNS(ANDROID, "drawable"));
        assertEquals(foreground.getAttributeNS(ANDROID, "inset"), inset.getAttributeNS(ANDROID, "inset"));
        assertTrue(Files.isRegularFile(resources().resolve("drawable-nodpi/launcher_standard.png")));
    }

    @Test public void android12PlusAllowsTheSelectedAliasIconWithoutAnOldLogoOverride() throws Exception {
        Element older = launchTheme("values");
        Element modern = launchTheme("values-v31");
        assertEquals("Theme.SplashScreen", modern.getAttribute("parent"));
        assertEquals("@null", item(modern, "windowSplashScreenAnimatedIcon"));
        assertEquals("@null", item(modern, "android:windowSplashScreenAnimatedIcon"));
        assertEquals(item(older, "windowSplashScreenBackground"), item(modern, "windowSplashScreenBackground"));
        assertEquals(item(older, "postSplashScreenTheme"), item(modern, "postSplashScreenTheme"));
        Element manifest = parse(resources().getParent().resolve("AndroidManifest.xml"));
        Element application = (Element) manifest.getElementsByTagName("application").item(0);
        assertEquals("@mipmap/ic_launcher", application.getAttributeNS(ANDROID, "icon"));
        NodeList aliases = manifest.getElementsByTagName("activity-alias");
        assertEquals(8, aliases.getLength());
        for (int i = 0; i < aliases.getLength(); i++) {
            Element alias = (Element) aliases.item(i);
            assertEquals(".MainActivity", alias.getAttributeNS(ANDROID, "targetActivity"));
            assertTrue(alias.getAttributeNS(ANDROID, "icon").startsWith("@mipmap/ic_launcher"));
        }
    }
}
