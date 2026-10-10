package com.zerodebtplan.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// The phone's own lock for the plan (js/device.js):
// - getKey: a random 256-bit data key, kept only sealed by a key that lives in the Android
//   Keystore (it never leaves the phone's secure hardware). The plan is saved encrypted with it
//   even without a PIN; a copy of the app's files is useless on another device.
// - Fingerprint or face unlock for the PIN lock: the PIN is kept sealed the same way and handed
//   back only after the phone confirms it's you (verify).
// - takeAction: the home-screen shortcut the app was opened with ("quick": quick entry).
// Nothing here talks to a network.
@CapacitorPlugin(name = "DeviceKey")
public class DeviceKeyPlugin extends Plugin {
    // What the app was opened for (the home-screen shortcut), until the page takes it.
    static volatile String pendingAction = null;
    private static final String ALIAS = "zdp_device_seal";
    private static final String PREFS = "zdp_device_key";

    private SecretKey sealKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            kg.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String seal(byte[] plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, sealKey());
        byte[] data = c.doFinal(plain);
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP);
    }

    private byte[] unseal(String sealed) throws Exception {
        String[] p = sealed.split(":");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, sealKey(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return c.doFinal(Base64.decode(p[1], Base64.NO_WRAP));
    }

    @PluginMethod
    public void getKey(PluginCall call) {
        try {
            String sealed = prefs().getString("key", null);
            byte[] raw;
            if (sealed == null) {
                raw = new byte[32];
                new SecureRandom().nextBytes(raw);
                prefs().edit().putString("key", seal(raw)).commit();
            } else {
                raw = unseal(sealed);
            }
            JSObject r = new JSObject();
            r.put("key", Base64.encodeToString(raw, Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No device key");
        }
    }

    @PluginMethod
    public void setSecret(PluginCall call) {
        try {
            String value = call.getString("value", "");
            prefs().edit().putString("secret", seal(value.getBytes(StandardCharsets.UTF_8))).commit();
            call.resolve();
        } catch (Exception e) {
            call.reject("Not saved");
        }
    }

    // Only called by the app right after verify() succeeded.
    @PluginMethod
    public void getSecret(PluginCall call) {
        try {
            String sealed = prefs().getString("secret", null);
            JSObject r = new JSObject();
            r.put("value", sealed == null ? null : new String(unseal(sealed), StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Not readable");
        }
    }

    @PluginMethod
    public void clearSecret(PluginCall call) {
        prefs().edit().remove("secret").commit();
        call.resolve();
    }

    // Forget everything (the 10th wrong PIN erases the app's data).
    @PluginMethod
    public void clearAll(PluginCall call) {
        prefs().edit().clear().commit();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(ALIAS);
        } catch (Exception e) {
            // nothing to delete
        }
        call.resolve();
    }

    @PluginMethod
    public void takeAction(PluginCall call) {
        JSObject r = new JSObject();
        r.put("action", pendingAction);
        pendingAction = null;
        call.resolve(r);
    }

    @PluginMethod
    public void canVerify(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject o = new JSObject();
        o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(o);
    }

    @PluginMethod
    public void verify(PluginCall call) {
        String title = call.getString("title", "Unlock");
        String subtitle = call.getString("subtitle", "");
        String cancel = call.getString("cancel", "Use PIN");
        getActivity().runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    call.resolve();
                }

                @Override
                public void onAuthenticationError(int code, CharSequence msg) {
                    call.reject(String.valueOf(msg), String.valueOf(code));
                }
            });
            prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText(cancel)
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build());
        });
    }
}
