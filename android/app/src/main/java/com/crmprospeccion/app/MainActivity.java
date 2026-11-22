package com.crmprospeccion.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (this.bridge != null && this.bridge.getWebView() != null) {
      this.bridge.getWebView().addJavascriptInterface(new PermissionBridge(), "CrmNativePerms");
    }
  }

  private class PermissionBridge {
    @JavascriptInterface
    public boolean hasAllFilesPermission() {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        return true;
      }
      return Environment.isExternalStorageManager();
    }

    @JavascriptInterface
    public void openAllFilesSettings() {
      runOnUiThread(() -> {
        try {
          Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
          intent.setData(Uri.parse("package:" + getPackageName()));
          startActivity(intent);
        } catch (Exception e) {
          Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
          startActivity(fallback);
        }
      });
    }

    @JavascriptInterface
    public boolean hasNotificationPermission() {
      if (Build.VERSION.SDK_INT < 33) {
        return true;
      }
      return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
      if (Build.VERSION.SDK_INT >= 33) {
        runOnUiThread(() -> requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 1001));
      }
    }
  }
}
