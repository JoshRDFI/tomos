package com.rdfindustries.savefile

import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val SAVE_REQUEST = 7201

// Saves text where the user picks (Downloads, Documents, a Drive folder…)
// through Android's "save as" picker (ACTION_CREATE_DOCUMENT). The app needs
// no storage permission: it can write only to the file the user chose.
class SaveFileModule : Module() {
  private var pending: Pair<Promise, String>? = null

  override fun definition() = ModuleDefinition {
    Name("SaveFile")

    AsyncFunction("saveDocument") { name: String, mimeType: String, content: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(CodedException("NO_ACTIVITY", "The app isn't on screen", null))
        return@AsyncFunction
      }
      pending?.first?.resolve(false)
      pending = promise to content
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(mimeType)
        .putExtra(Intent.EXTRA_TITLE, name)
      activity.startActivityForResult(intent, SAVE_REQUEST)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != SAVE_REQUEST) return@OnActivityResult
      val (promise, content) = pending ?: return@OnActivityResult
      pending = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(false)
        return@OnActivityResult
      }
      try {
        val resolver = appContext.reactContext?.contentResolver ?: throw IllegalStateException("no context")
        resolver.openOutputStream(uri, "wt")?.use { it.write(content.toByteArray(Charsets.UTF_8)) }
          ?: throw IllegalStateException("couldn't open the file")
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject(CodedException("SAVE_FAILED", e.message ?: "Couldn't save the file", e))
      }
    }
  }
}
