package com.zerodebtplan.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The app's own plugin: the device key, fingerprint unlock, the home-screen shortcut.
        registerPlugin(DeviceKeyPlugin.class);
        registerPlugin(WidgetsPlugin.class);
        super.onCreate(savedInstanceState);
        // FLAG_SECURE: the app's screen is blank in the recent-apps switcher and can't be captured in
        // screenshots or screen recordings (your amounts stay private).
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        addQuickShortcut();
        noteAction(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        noteAction(intent);
    }

    // Long-press the app icon → "Add expense": opens quick entry (the page asks DeviceKey.takeAction).
    private void addQuickShortcut() {
        try {
            Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("zerodebtplan://quick"), this, MainActivity.class);
            ShortcutInfoCompat s = new ShortcutInfoCompat.Builder(this, "quick")
                .setShortLabel(getString(R.string.shortcut_quick))
                .setLongLabel(getString(R.string.shortcut_quick_long))
                .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
                .setIntent(open)
                .build();
            ShortcutManagerCompat.pushDynamicShortcut(this, s);
        } catch (Exception e) {
            // no launcher shortcuts on this phone
        }
    }

    private void noteAction(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        // The shortcut (quick entry) or a widget (the budget, the goals).
        if (data != null && "zerodebtplan".equals(data.getScheme()) && java.util.Arrays.asList("quick", "budget", "goals").contains(data.getHost())) DeviceKeyPlugin.pendingAction = data.getHost();
    }
}
