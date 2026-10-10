package com.zerodebtplan.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

// Home-screen widget: this month's categories over their budget or nearly (percentages only), so
// you know where to stop spending. Tapping it opens the budget.
public class BudgetWidget extends AppWidgetProvider {
    private static final int[] ROWS = { R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4 };
    private static final int[] NAMES = { R.id.w_name1, R.id.w_name2, R.id.w_name3, R.id.w_name4 };
    private static final int[] PCTS = { R.id.w_pct1, R.id.w_pct2, R.id.w_pct3, R.id.w_pct4 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(context));
    }

    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, BudgetWidget.class))) m.updateAppWidget(id, views(c));
    }

    // Opens the app on a screen ("budget", "goals"): MainActivity hands it to the page.
    static PendingIntent open(Context c, String screen, int code) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("zerodebtplan://" + screen), c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static JSONObject data(Context c, String key) {
        try {
            String s = WidgetsPlugin.prefs(c).getString(key, null);
            return s == null || "null".equals(s) ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    static RemoteViews views(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_budget);
        v.setOnClickPendingIntent(R.id.w_root, open(c, "budget", 1));
        JSONObject d = data(c, "budget");
        if (d == null) {
            v.setTextViewText(R.id.w_title, c.getString(R.string.widget_budget));
            v.setTextViewText(R.id.w_empty, c.getString(R.string.widget_off));
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
            for (int r : ROWS) v.setViewVisibility(r, View.GONE);
            v.setTextViewText(R.id.w_footer, "");
            return v;
        }
        v.setTextViewText(R.id.w_title, d.optString("title"));
        JSONArray rows = d.optJSONArray("rows");
        int n = rows == null ? 0 : Math.min(rows.length(), ROWS.length);
        for (int k = 0; k < ROWS.length; k++) {
            JSONObject r = k < n ? rows.optJSONObject(k) : null;
            if (r == null) {
                v.setViewVisibility(ROWS[k], View.GONE);
                continue;
            }
            v.setViewVisibility(ROWS[k], View.VISIBLE);
            v.setTextViewText(NAMES[k], r.optString("name"));
            v.setTextViewText(PCTS[k], r.optString("pct"));
            v.setTextColor(PCTS[k], "over".equals(r.optString("level")) ? 0xFFFCA5A5 : 0xFFFCD34D);
        }
        String empty = d.optString("empty");
        v.setTextViewText(R.id.w_empty, empty);
        v.setViewVisibility(R.id.w_empty, empty.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.w_footer, d.optString("footer"));
        return v;
    }
}
