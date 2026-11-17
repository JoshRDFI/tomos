package com.rdfindustries.hfdownload

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class EnqueueOptions : Record {
  @Field var url: String = ""
  @Field var relativePath: String = ""
  @Field var title: String = ""
  @Field var wifiOnly: Boolean = true
}

// Thin wrapper over Android's DownloadManager. The system runs the download
// (survives the app being closed), shows the notification and retries
// transient network errors. Files land in the app-specific external files
// dir, which needs no storage permission.
class HfDownloadModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val manager: DownloadManager
    get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  override fun definition() = ModuleDefinition {
    Name("HfDownload")

    Function("externalModelsDir") {
      val base = context.getExternalFilesDir(null) ?: throw IllegalStateException("External files dir unavailable")
      java.io.File(base, "models").absolutePath
    }

    AsyncFunction("enqueue") { o: EnqueueOptions ->
      val request = DownloadManager.Request(Uri.parse(o.url))
        .setTitle(o.title)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(!o.wifiOnly)
        .setAllowedOverRoaming(false)
        .setDestinationInExternalFilesDir(context, null, o.relativePath)
      manager.enqueue(request)
    }

    AsyncFunction("query") { ids: List<Long> ->
      val found = mutableMapOf<Long, Map<String, Any?>>()
      if (ids.isNotEmpty()) {
        manager.query(DownloadManager.Query().setFilterById(*ids.toLongArray()))?.use { c ->
          val idCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
          val statusCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
          val soFarCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
          val totalCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
          val reasonCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)
          val uriCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)
          while (c.moveToNext()) {
            val status = when (c.getInt(statusCol)) {
              DownloadManager.STATUS_PENDING -> "pending"
              DownloadManager.STATUS_RUNNING -> "running"
              DownloadManager.STATUS_PAUSED -> "paused"
              DownloadManager.STATUS_SUCCESSFUL -> "succeeded"
              else -> "failed"
            }
            val localUri = c.getString(uriCol)
            val id = c.getLong(idCol)
            found[id] = mapOf(
              "id" to id.toDouble(),
              "status" to status,
              "bytesSoFar" to c.getLong(soFarCol).toDouble(),
              "totalBytes" to c.getLong(totalCol).toDouble(),
              "reason" to if (status == "failed" || status == "paused") c.getInt(reasonCol) else null,
              "localPath" to localUri?.let { Uri.parse(it).path }
            )
          }
        }
      }
      ids.map { id ->
        found[id] ?: mapOf(
          "id" to id.toDouble(), "status" to "missing", "bytesSoFar" to 0.0,
          "totalBytes" to 0.0, "reason" to null, "localPath" to null
        )
      }
    }

    AsyncFunction("remove") { ids: List<Long> ->
      if (ids.isNotEmpty()) manager.remove(*ids.toLongArray())
    }
  }
}
