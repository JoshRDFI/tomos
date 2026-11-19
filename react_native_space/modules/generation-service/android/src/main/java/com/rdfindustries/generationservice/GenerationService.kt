package com.rdfindustries.generationservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Foreground service that runs while a reply or summary is generating, so
 * Android doesn't freeze the app (and the model) when the screen goes off.
 * It does no work itself: the model runs in the app's own threads. It shows
 * the ongoing notification, with Stop, and holds a partial wake lock.
 */
class GenerationService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP_REQUEST) {
      onStopRequest?.invoke()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Tomos"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Generating…"
    val notification = buildOngoing(this, title, text)
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(ONGOING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(ONGOING_ID, notification)
    }
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tomos:generation").apply {
        setReferenceCounted(false)
        // Safety net: a reply never needs this long; the app stops the service when it's done.
        acquire(60 * 60 * 1000L)
      }
    }
    // Not restarted if Android kills it: the reply it was keeping alive is gone too.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val ACTION_STOP_REQUEST = "com.rdfindustries.generationservice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val ONGOING_ID = 7101
    const val DONE_ID = 7102
    const val CHANNEL_ONGOING = "generation"
    const val CHANNEL_DONE = "replies"

    /** Set by the module: the notification's Stop button. */
    @Volatile var onStopRequest: (() -> Unit)? = null

    fun ensureChannels(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(NotificationChannel(CHANNEL_ONGOING, "Generating", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while a reply is being written"
        setShowBadge(false)
      })
      nm.createNotificationChannel(NotificationChannel(CHANNEL_DONE, "Replies", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "When a reply finishes while you're away"
      })
    }

    @Suppress("DEPRECATION")
    fun builder(context: Context, channel: String): Notification.Builder {
      ensureChannels(context)
      return if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else Notification.Builder(context)
    }

    private fun immutable() = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)

    fun openAppIntent(context: Context, uri: android.net.Uri?): PendingIntent {
      val intent = if (uri != null) {
        Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
      } else {
        context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      return PendingIntent.getActivity(context, uri?.hashCode() ?: 0, intent, immutable())
    }

    fun buildOngoing(context: Context, title: String, text: String): Notification {
      val stop = PendingIntent.getService(
        context, 1,
        Intent(context, GenerationService::class.java).setAction(ACTION_STOP_REQUEST),
        immutable(),
      )
      @Suppress("DEPRECATION")
      return builder(context, CHANNEL_ONGOING)
        .setSmallIcon(R.drawable.ic_stat_generation)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openAppIntent(context, null))
        .addAction(Notification.Action.Builder(null, "Stop", stop).build())
        .build()
    }
  }
}
