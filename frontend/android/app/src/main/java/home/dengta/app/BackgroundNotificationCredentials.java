package home.dengta.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class BackgroundNotificationCredentials {
    private static final String PREFS_NAME =
        "dengta_home_notification_identity";
    private static final String KEY_ALIAS =
        "dengta_background_notification_key_v1";
    private static final String TOKEN_CIPHERTEXT_KEY =
        "token_ciphertext";
    private static final String TOKEN_IV_KEY = "token_iv";
    private static final String USER_ID_KEY = "user_id";
    private static final String COMPANION_ID_KEY = "companion_id";
    private static final String DEVICE_ID_KEY = "device_id";
    private static final int GCM_TAG_BITS = 128;

    private BackgroundNotificationCredentials() {}

    static final class Identity {
        final String installationToken;
        final long expiresAt;
        final String deviceId;
        final String userId;
        final String companionId;

        Identity(
            String installationToken,
            long expiresAt,
            String deviceId,
            String userId,
            String companionId
        ) {
            this.installationToken = installationToken;
            this.expiresAt = expiresAt;
            this.deviceId = deviceId;
            this.userId = userId;
            this.companionId = companionId;
        }

        boolean isExpired(long now) {
            return expiresAt <= now;
        }
    }

    static void store(
        Context context,
        String installationToken,
        long expiresAt,
        String deviceId,
        String userId,
        String companionId
    ) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length == 0) {
            throw new IllegalStateException(
                "Android Keystore did not generate an encryption IV"
            );
        }
        JSONObject secrets = new JSONObject();
        secrets.put("installation_token", installationToken);
        secrets.put("expires_at", expiresAt);
        byte[] ciphertext = cipher.doFinal(
            secrets.toString().getBytes(StandardCharsets.UTF_8)
        );
        preferences(context)
            .edit()
            .putString(
                TOKEN_CIPHERTEXT_KEY,
                Base64.encodeToString(ciphertext, Base64.NO_WRAP)
            )
            .putString(
                TOKEN_IV_KEY,
                Base64.encodeToString(iv, Base64.NO_WRAP)
            )
            .putString(DEVICE_ID_KEY, deviceId)
            .putString(USER_ID_KEY, userId)
            .putString(COMPANION_ID_KEY, companionId)
            .apply();
    }

    static Identity read(Context context) {
        SharedPreferences preferences = preferences(context);
        String ciphertextValue = preferences.getString(
            TOKEN_CIPHERTEXT_KEY,
            ""
        );
        String ivValue = preferences.getString(TOKEN_IV_KEY, "");
        String deviceId = preferences.getString(DEVICE_ID_KEY, "");
        String userId = preferences.getString(USER_ID_KEY, "");
        String companionId = preferences.getString(COMPANION_ID_KEY, "");
        if (
            isEmpty(ciphertextValue) ||
            isEmpty(ivValue) ||
            isEmpty(deviceId) ||
            isEmpty(userId) ||
            isEmpty(companionId)
        ) {
            return null;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(
                    GCM_TAG_BITS,
                    Base64.decode(ivValue, Base64.NO_WRAP)
                )
            );
            byte[] plaintext = cipher.doFinal(
                Base64.decode(ciphertextValue, Base64.NO_WRAP)
            );
            JSONObject secrets = new JSONObject(
                new String(plaintext, StandardCharsets.UTF_8)
            );
            String installationToken = secrets.optString(
                "installation_token",
                ""
            );
            long expiresAt = secrets.optLong("expires_at", 0L);
            if (installationToken.isEmpty() || expiresAt <= 0L) {
                clear(context);
                return null;
            }
            return new Identity(
                installationToken,
                expiresAt,
                deviceId,
                userId,
                companionId
            );
        } catch (Exception error) {
            clear(context);
            return null;
        }
    }

    static String currentScopeKey(Context context) {
        SharedPreferences preferences = preferences(context);
        return String.valueOf(preferences.getString(USER_ID_KEY, "")) +
            ":" +
            String.valueOf(
                preferences.getString(COMPANION_ID_KEY, "")
            );
    }

    static void clear(Context context) {
        preferences(context).edit().clear().apply();
    }

    private static boolean isEmpty(String value) {
        return value == null || value.isEmpty();
    }

    private static SharedPreferences preferences(Context context) {
        return context
            .getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT |
                    KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(
                    KeyProperties.ENCRYPTION_PADDING_NONE
                )
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }
}
