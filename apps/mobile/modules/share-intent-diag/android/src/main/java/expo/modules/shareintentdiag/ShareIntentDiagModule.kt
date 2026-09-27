package expo.modules.shareintentdiag

import android.content.Intent
import android.util.Patterns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Diagnostic-only module (FACEBOOK-SHARE-INGESTION-01): summarizes the share Intent that
 * expo-sharing retained, without returning any raw value.
 *
 * Source: expo-sharing's `SharingSingleton.intent`. It is set from the original ACTION_SEND Intent
 * in Activity.onCreate (cold start) and onNewIntent (warm start), before JS is notified, and is
 * only cleared by `clearSharedPayloads()`. It is read by reflection so this module neither patches
 * nor links against expo-sharing. A null Intent is `no_intent`; a missing class/member or any other
 * inspection failure is `native_error`.
 */
class ShareIntentDiagModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareIntentDiag")

    // Returns a fixed-status envelope: {status:"ok", shape}, {status:"no_intent"} or
    // {status:"native_error"}. Any failure (missing class, unparcelable extras, ...) is caught in
    // ShareIntentShape.envelope; nothing is thrown to JS and no exception detail is returned.
    Function("getShareIntentShape") {
      ShareIntentShape.envelope({ retainedShareIntent()?.let { intent -> toRaw(intent) } }) { text ->
        Patterns.WEB_URL.matcher(text).matches()
      }
    }
  }

  private fun retainedShareIntent(): Intent? {
    val singleton = Class.forName("expo.modules.sharing.SharingSingleton")
    val instance = singleton.getField("INSTANCE").get(null)
    return singleton.getMethod("getIntent").invoke(instance) as? Intent
  }

  private fun toRaw(intent: Intent): RawShareIntent {
    val extras = intent.extras
    val knownKeys = setOf(
      Intent.EXTRA_TEXT,
      Intent.EXTRA_SUBJECT,
      Intent.EXTRA_TITLE,
      Intent.EXTRA_HTML_TEXT,
      Intent.EXTRA_STREAM,
    )
    val clip = intent.clipData
    // All items are read so the mirror check covers every ClipData text; the summary itself reports
    // at most MAX_CLIP_ITEMS of them.
    val clipItems = clip?.let { data ->
      (0 until data.itemCount).map { index ->
        val item = data.getItemAt(index)
        RawClipItem(text = item.text, hasUri = item.uri != null, htmlText = item.htmlText)
      }
    }
    return RawShareIntent(
      action = intent.action,
      type = intent.type,
      text = extras?.getCharSequence(Intent.EXTRA_TEXT),
      subject = extras?.getCharSequence(Intent.EXTRA_SUBJECT),
      title = extras?.getCharSequence(Intent.EXTRA_TITLE),
      html = extras?.getCharSequence(Intent.EXTRA_HTML_TEXT),
      hasStream = extras?.containsKey(Intent.EXTRA_STREAM) == true,
      clipItems = clipItems,
      clipItemTotal = clip?.itemCount ?: 0,
      otherExtraCount = extras?.keySet()?.count { it !in knownKeys } ?: 0,
    )
  }
}
