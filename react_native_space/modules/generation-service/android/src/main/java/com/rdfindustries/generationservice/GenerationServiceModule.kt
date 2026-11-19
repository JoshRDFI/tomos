package com.rdfindustries.generationservice

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StartOptions : Record {
  @Field var title: String = "LLM Chat"
  @Field var text: String = "Generating…"
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
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (e: Exception) {
        Log.w("GenerationService", "start refused: ${e.message}")
        false
      }
    }

    Function("stop") {
      context.stopService(Intent(context, GenerationService::class.java))
      Unit
    }

    // "Reply ready": tapping it opens the chat (llmchat:///?openSession=<id>).
    Function("notifyDone") { o: DoneOptions ->
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val uri = Uri.parse("llmchat:///?openSession=" + Uri.encode(o.sessionId))
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
