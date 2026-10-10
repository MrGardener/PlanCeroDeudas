package com.zerodebtplan.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The home-screen widgets' content, prepared by the app (js/views/phone.js) in its language:
// percentages and dates, never amounts or goal names. Kept here until the next update; clear()
// blanks the widgets (turned off in Settings, or the app's data erased).
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {
    static final String PREFS = "zdp_widgets";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context c = getContext();
        prefs(c).edit().putString("budget", call.getString("budget", "null")).putString("goal", call.getString("goal", "null")).commit();
        BudgetWidget.refresh(c);
        GoalWidget.refresh(c);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context c = getContext();
        prefs(c).edit().clear().commit();
        BudgetWidget.refresh(c);
        GoalWidget.refresh(c);
        call.resolve();
    }
}
