package com.rdfindustries.generationservice

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import java.io.File
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StartOptions : Record {
  @Field var title: String = "Tomos"
  @Field var text: String = "Generating…"
  @Field var pausedText: String? = null
}

class DoneOptions : Record {
  @Field var title: String = "Reply ready"
  @Field var body: String = ""
  @Field var subtitle: String? = null
  @Field var sessionId: String = ""
}

class GenerationServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("GenerationService")
    Events("onStopRequest")

    OnCreate {
      GenerationService.onStopRequest = { sendEvent("onStopRequest", emptyMap<String, Any>()) }
    }
    OnDestroy {
      GenerationService.onStopRequest = null
    }

    // Start the service, or update its text if it's running. Android 12+
    // refuses to start one from the background: false, and the reply carries
    // on as before (frozen while the screen is off).
    Function("start") { o: StartOptions ->
      val intent = Intent(context, GenerationService::class.java)
        .putExtra(GenerationService.EXTRA_TITLE, o.title)
        .putExtra(GenerationService.EXTRA_TEXT, o.text)
        .putExtra(GenerationService.EXTRA_PAUSED_TEXT, o.pausedText)
      GenerationService.cancelStop()
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (e: Exception) {
        Log.w("GenerationService", "start refused: ${e.message}")
        false
      }
    }

    Function("stop") {
      GenerationService.scheduleStop(context)
      Unit
    }

    Function("progress") { count: Long ->
      GenerationService.recordProgress(count)
    }

    Function("takeSqueezed") {
      GenerationService.takeSqueezed()
    }

    // Each core's top speed in kHz, to pick a thread count (lib/device.ts).
    // Cores whose speed can't be read are left out.
    Function("cpuMaxFrequencies") {
      val cpus = File("/sys/devices/system/cpu").listFiles { f -> f.name.matches(Regex("cpu\\d+")) } ?: emptyArray()
      cpus.mapNotNull { runCatching { File(it, "cpufreq/cpuinfo_max_freq").readText().trim().toLong() }.getOrNull() }
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Android's "let the app run in the background?" dialog; the battery
    // settings list if a phone doesn't offer that dialog.
    Function("requestIgnoreBatteryOptimizations") {
      val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName))
      val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      val activity = appContext.currentActivity
      listOf(direct, list).any { intent ->
        try {
          if (activity != null) activity.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (e: Exception) {
          Log.w("GenerationService", "battery settings: ${e.message}")
          false
        }
      }
    }

    // "Reply ready": tapping it opens the chat (tomos:///?openSession=<id>).
    Function("notifyDone") { o: DoneOptions ->
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val uri = Uri.parse("tomos:///?openSession=" + Uri.encode(o.sessionId))
      val b = GenerationService.builder(context, GenerationService.CHANNEL_DONE)
        .setSmallIcon(R.drawable.ic_stat_generation)
        .setContentTitle(o.title)
        .setContentText(o.body)
        .setAutoCancel(true)
        .setContentIntent(GenerationService.openAppIntent(context, uri))
      o.subtitle?.let { b.setSubText(it) }
      try {
        nm.notify(GenerationService.DONE_ID, b.build())
      } catch (e: SecurityException) {
        // Notifications not allowed: the reply is still saved.
        Log.w("GenerationService", "notify refused: ${e.message}")
      }
      Unit
    }
  }
}
