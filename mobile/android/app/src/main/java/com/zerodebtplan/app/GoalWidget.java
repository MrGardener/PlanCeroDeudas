package com.zerodebtplan.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

// Home-screen widget: the goal closest to done — how far along (%), the month it's done and the
// pace it needs. No amounts and no goal name. Tapping it opens the goals.
public class GoalWidget extends AppWidgetProvider {
    private static final int[] LINES = { R.id.w_line1, R.id.w_line2, R.id.w_line3 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(context));
    }

    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, GoalWidget.class))) m.updateAppWidget(id, views(c));
    }

    static RemoteViews views(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_goal);
        v.setOnClickPendingIntent(R.id.w_root, BudgetWidget.open(c, "goals", 2));
        JSONObject d = BudgetWidget.data(c, "goal");
        if (d == null) {
            v.setTextViewText(R.id.w_title, c.getString(R.string.widget_goal));
            v.setTextViewText(R.id.w_line1, c.getString(R.string.widget_off));
            v.setViewVisibility(R.id.w_line1, View.VISIBLE);
            v.setViewVisibility(R.id.w_line2, View.GONE);
            v.setViewVisibility(R.id.w_line3, View.GONE);
            v.setViewVisibility(R.id.w_progress, View.GONE);
            v.setTextViewText(R.id.w_pct, "");
            v.setTextViewText(R.id.w_footer, "");
            return v;
        }
        int pct = Math.max(0, Math.min(100, d.optInt("pct")));
        v.setTextViewText(R.id.w_title, d.optString("title"));
        v.setTextViewText(R.id.w_pct, pct + "%");
        v.setViewVisibility(R.id.w_progress, View.VISIBLE);
        v.setProgressBar(R.id.w_progress, 100, pct, false);
        JSONArray lines = d.optJSONArray("lines");
        for (int k = 0; k < LINES.length; k++) {
            String text = lines != null && k < lines.length() ? lines.optString(k) : "";
            v.setTextViewText(LINES[k], text);
            v.setViewVisibility(LINES[k], text.isEmpty() ? View.GONE : View.VISIBLE);
        }
        v.setTextViewText(R.id.w_footer, d.optString("footer"));
        return v;
    }
}
