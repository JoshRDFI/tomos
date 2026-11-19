package com.rdfindustries.generationservice

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Foreground service that runs while a reply or summary is generating, so
 * Android doesn't freeze the app (and the model) when the screen goes off.
 * It does no work itself: the model runs in the app's own threads. It shows
 * the ongoing notification, with Stop, and holds a partial wake lock.
 *
 * Timing lives here, not in the app's JavaScript, whose timers don't run while
 * the app is in the background: the service stops itself shortly after the
 * last work ends, and while a reply runs off screen it checks every few
 * seconds whether tokens are still coming (see [checkStall]).
 */
class GenerationService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP_REQUEST) {
      onStopRequest?.invoke()
      return START_NOT_STICKY
    }
    title = intent?.getStringExtra(EXTRA_TITLE) ?: "Tomos"
    text = intent?.getStringExtra(EXTRA_TEXT) ?: "Generating…"
    pausedText = intent?.getStringExtra(EXTRA_PAUSED_TEXT)
    showingPaused = false
    synchronized(samples) { samples.clear() }
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
    handler.removeCallbacks(check)
    handler.postDelayed(check, CHECK_MS)
    // Not restarted if Android kills it: the reply it was keeping alive is gone too.
    return START_NOT_STICKY
  }

  private val check = object : Runnable {
    override fun run() {
      checkStall()
      handler.postDelayed(this, CHECK_MS)
    }
  }

  /**
   * A reply that slows to under [STALL_TOKENS] tokens in [STALL_MS] while the
   * app is off screen has stalled: show [pausedText] until it's on screen again
   * or tokens flow again. Before the first token (prompt processing) there's
   * nothing to judge.
   */
  private fun checkStall() {
    val paused = pausedText ?: return
    val stalled = !appVisible() && synchronized(samples) {
      val now = System.currentTimeMillis()
      val last = samples.lastOrNull() ?: return@synchronized false
      val before = samples.lastOrNull { it[0] <= now - STALL_MS } ?: return@synchronized false
      last[1] - before[1] < STALL_TOKENS
    }
    if (stalled && !showingPaused) {
      showingPaused = true
      squeezed = true
      notifyOngoing(paused)
    } else if (!stalled && showingPaused) {
      showingPaused = false
      notifyOngoing(text)
    }
  }

  private fun notifyOngoing(t: String) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.notify(ONGOING_ID, buildOngoing(this, title, t))
  }

  private fun appVisible(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  override fun onDestroy() {
    handler.removeCallbacks(check)
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val ACTION_STOP_REQUEST = "com.rdfindustries.generationservice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_PAUSED_TEXT = "pausedText"
    private const val CHECK_MS = 5_000L
    private const val STALL_MS = 20_000L
    private const val STALL_TOKENS = 10L
    private const val STOP_DELAY_MS = 5_000L

    private val handler = Handler(Looper.getMainLooper())
    private var title = "Tomos"
    private var text = "Generating…"
    private var pausedText: String? = null
    private var showingPaused = false
    @Volatile private var squeezed = false
    /** (time ms, tokens so far) for the current reply. */
    private val samples = ArrayDeque<LongArray>()
    private var pendingStop: Runnable? = null

    fun recordProgress(count: Long) {
      synchronized(samples) {
        samples.addLast(longArrayOf(System.currentTimeMillis(), count))
        while (samples.size > 120) samples.removeFirst()
      }
    }

    fun takeSqueezed(): Boolean {
      val was = squeezed
      squeezed = false
      return was
    }

    /** Stop a few seconds from now, so work that follows right after keeps the service. */
    fun scheduleStop(context: Context) {
      cancelStop()
      val app = context.applicationContext
      val r = Runnable {
        pendingStop = null
        app.stopService(Intent(app, GenerationService::class.java))
      }
      pendingStop = r
      handler.postDelayed(r, STOP_DELAY_MS)
    }

    fun cancelStop() {
      pendingStop?.let { handler.removeCallbacks(it) }
      pendingStop = null
    }
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
