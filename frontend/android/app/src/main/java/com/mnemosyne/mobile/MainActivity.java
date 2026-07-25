package com.mnemosyne.mobile;

import android.content.Intent;
import android.content.IntentSender;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MnemosyneUpdate";
    private static final int UPDATE_REQUEST_CODE = 1307;

    private AppUpdateManager appUpdateManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        appUpdateManager = AppUpdateManagerFactory.create(this);
        checkForImmediateUpdate();
    }

    @Override
    public void onResume() {
        super.onResume();
        resumeImmediateUpdateIfNeeded();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == UPDATE_REQUEST_CODE && resultCode != RESULT_OK) {
            Log.w(TAG, "In-app update flow finished without installing. Result: " + resultCode);
        }
    }

    private void checkForImmediateUpdate() {
        if (appUpdateManager == null) {
            return;
        }

        appUpdateManager
            .getAppUpdateInfo()
            .addOnSuccessListener(appUpdateInfo -> {
                if (appUpdateInfo.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                    && appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                    startImmediateUpdate(appUpdateInfo);
                }
            })
            .addOnFailureListener(error -> Log.i(TAG, "In-app update check unavailable", error));
    }

    private void resumeImmediateUpdateIfNeeded() {
        if (appUpdateManager == null) {
            return;
        }

        appUpdateManager
            .getAppUpdateInfo()
            .addOnSuccessListener(appUpdateInfo -> {
                if (appUpdateInfo.updateAvailability()
                    == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                    startImmediateUpdate(appUpdateInfo);
                }
            })
            .addOnFailureListener(error -> Log.i(TAG, "In-app update resume unavailable", error));
    }

    private void startImmediateUpdate(AppUpdateInfo appUpdateInfo) {
        try {
            appUpdateManager.startUpdateFlowForResult(
                appUpdateInfo,
                this,
                AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                UPDATE_REQUEST_CODE
            );
        } catch (IntentSender.SendIntentException error) {
            Log.e(TAG, "Could not start in-app update flow", error);
        }
    }
}
