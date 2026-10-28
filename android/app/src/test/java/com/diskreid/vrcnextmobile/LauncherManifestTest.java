package com.diskreid.vrcnextmobile;

import static org.junit.Assert.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

public class LauncherManifestTest {
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";

    private Path resources() {
        Path app = Paths.get("src/main");
        if (!Files.isRegularFile(app.resolve("AndroidManifest.xml")))
            app = Paths.get("android/app/src/main");
        return app;
    }

    private Document parse(Path path) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(path.toFile());
    }

    @Test public void exactlyOneAliasIsEnabledAndMainActivityRemainsAValidTarget() throws Exception {
        Document document = parse(resources().resolve("AndroidManifest.xml"));
        Element application = (Element) document.getElementsByTagName("application").item(0);
        assertEquals("@mipmap/ic_launcher", application.getAttributeNS(ANDROID, "icon"));
        assertFalse(application.hasAttributeNS(ANDROID, "roundIcon"));
        NodeList activities = document.getElementsByTagName("activity");
        Element main = null;
        for (int i = 0; i < activities.getLength(); i++) {
            Element activity = (Element) activities.item(i);
            if (".MainActivity".equals(activity.getAttributeNS(ANDROID, "name"))) main = activity;
        }
        assertNotNull(main);
        assertEquals("true", main.getAttributeNS(ANDROID, "enabled"));
        assertEquals(0, main.getElementsByTagName("intent-filter").getLength());

        NodeList aliases = document.getElementsByTagName("activity-alias");
        assertEquals(LauncherIconPolicy.Icon.values().length, aliases.getLength());
        Map<String, Element> byName = new HashMap<>();
        int enabled = 0;
        for (int i = 0; i < aliases.getLength(); i++) {
            Element alias = (Element) aliases.item(i);
            assertNull(byName.put(alias.getAttributeNS(ANDROID, "name"), alias));
            assertEquals(".MainActivity", alias.getAttributeNS(ANDROID, "targetActivity"));
            assertEquals("true", alias.getAttributeNS(ANDROID, "exported"));
            assertEquals("android.intent.action.MAIN", ((Element) alias.getElementsByTagName("action")
                    .item(0)).getAttributeNS(ANDROID, "name"));
            assertEquals("android.intent.category.LAUNCHER", ((Element) alias.getElementsByTagName("category")
                    .item(0)).getAttributeNS(ANDROID, "name"));
            if ("true".equals(alias.getAttributeNS(ANDROID, "enabled"))) enabled++;
        }
        assertEquals(1, enabled);
        for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values()) {
            Element alias = byName.get(".launcher." + icon.alias);
            assertNotNull(alias);
            assertEquals(Boolean.toString(icon.manifestEnabled), alias.getAttributeNS(ANDROID, "enabled"));
            String suffix = icon == LauncherIconPolicy.Icon.STANDARD ? "" : "_" + icon.id.replace('-', '_');
            assertEquals("@mipmap/ic_launcher" + suffix, alias.getAttributeNS(ANDROID, "icon"));
        }
    }

    @Test public void eachStyleHasIndependentAdaptiveAndLegacyArtworkReferences() throws Exception {
        Path res = resources().resolve("res");
        for (LauncherIconPolicy.Icon icon : LauncherIconPolicy.Icon.values()) {
            String stem = "ic_launcher" + (icon == LauncherIconPolicy.Icon.STANDARD
                    ? "" : "_" + icon.id.replace('-', '_'));
            String image = "@drawable/launcher_" + icon.id.replace('-', '_');
            Document adaptive = parse(res.resolve("mipmap-anydpi-v26/" + stem + ".xml"));
            assertEquals("adaptive-icon", adaptive.getDocumentElement().getTagName());
            Element inset = (Element) adaptive.getElementsByTagName("inset").item(0);
            assertNotNull(inset);
            assertEquals(image, inset.getAttributeNS(ANDROID, "drawable"));
            assertEquals("16.67%", inset.getAttributeNS(ANDROID, "inset"));
            Document legacy = parse(res.resolve("mipmap-anydpi/" + stem + ".xml"));
            assertEquals("bitmap", legacy.getDocumentElement().getTagName());
            assertEquals(image, legacy.getDocumentElement().getAttributeNS(ANDROID, "src"));
        }
    }
}
