package expo.modules.shareintentdiag

/**
 * Pure, Android-free classification of an incoming share Intent (FACEBOOK-SHARE-INGESTION-01).
 *
 * Raw values (text, subject, title, HTML, URIs, extra keys) exist only inside [RawShareIntent] on
 * the native side. [summarize] returns ONLY enum strings, booleans, bounded counts and length
 * buckets; no input string, URI, key or derived hash can appear in its output.
 */
data class RawClipItem(
  val text: CharSequence?,
  val hasUri: Boolean,
  val htmlText: String?,
)

data class RawShareIntent(
  val action: String?,
  val type: String?,
  val text: CharSequence?,
  val subject: CharSequence?,
  val title: CharSequence?,
  val html: CharSequence?,
  val hasStream: Boolean,
  val clipItems: List<RawClipItem>?,
  val clipItemTotal: Int,
  val otherExtraCount: Int,
)

object ShareIntentShape {
  const val MAX_CLIP_ITEMS = 10
  const val MAX_OTHER_EXTRAS = 50

  private const val ACTION_SEND = "android.intent.action.SEND"
  private const val ACTION_SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"

  fun action(action: String?): String = when (action) {
    ACTION_SEND -> "send"
    ACTION_SEND_MULTIPLE -> "send_multiple"
    else -> "other"
  }

  fun typeCategory(type: String?): String {
    val normalized = type?.trim()?.lowercase() ?: return "other"
    return when {
      normalized.startsWith("text/") -> "text"
      normalized.startsWith("image/") -> "image"
      else -> "other"
    }
  }

  fun lengthBucket(value: CharSequence?): String {
    val length = value?.length ?: 0
    return when {
      length == 0 -> "0"
      length <= 100 -> "1-100"
      length <= 500 -> "101-500"
      else -> ">500"
    }
  }

  fun bounded(value: Int, max: Int): Int = value.coerceIn(0, max)

  /**
   * True only when EXTRA_TEXT is non-empty, at least one ClipData item has non-null text, and
   * EVERY non-null ClipData text equals EXTRA_TEXT exactly (content equality). False otherwise,
   * including: no EXTRA_TEXT, no ClipData text, or any differing ClipData text. Items without
   * text (URI/HTML only) are ignored here; they are reported by the per-item flags. Considers all
   * items, not only the ones reported. Only this boolean leaves; neither text is returned.
   */
  fun clipTextMatchesExtraText(extraText: CharSequence?, clipItems: List<RawClipItem>?): Boolean {
    val extra = extraText?.toString()
    if (extra.isNullOrEmpty()) return false
    val clipTexts = (clipItems ?: emptyList()).mapNotNull { it.text?.toString() }
    return clipTexts.isNotEmpty() && clipTexts.all { it == extra }
  }

  /**
   * Fixed-status envelope for the JS boundary. [load] returns null when no share Intent is
   * retained and may throw on inspection failure; a throw becomes `native_error` with no class,
   * message, stack or value.
   */
  fun envelope(load: () -> RawShareIntent?, isWebUrl: (String) -> Boolean): Map<String, Any> =
    try {
      val raw = load()
      if (raw == null) mapOf("status" to "no_intent") else mapOf("status" to "ok", "shape" to summarize(raw, isWebUrl))
    } catch (_: Throwable) {
      mapOf("status" to "native_error")
    }

  /**
   * [isWebUrl] is the whole-string URL matcher (android.util.Patterns.WEB_URL in production, the
   * same check expo-sharing uses). Only its boolean result leaves this function.
   */
  fun summarize(raw: RawShareIntent, isWebUrl: (String) -> Boolean): Map<String, Any> {
    val text = raw.text?.toString()
    val clipItems = (raw.clipItems ?: emptyList()).take(MAX_CLIP_ITEMS).map { item ->
      mapOf(
        "hasText" to !item.text.isNullOrEmpty(),
        "hasUri" to item.hasUri,
        "hasHtml" to !item.htmlText.isNullOrEmpty(),
      )
    }
    return mapOf(
      "action" to action(raw.action),
      "typeCategory" to typeCategory(raw.type),
      "hasText" to (raw.text != null),
      "hasSubject" to (raw.subject != null),
      "hasTitle" to (raw.title != null),
      "hasHtml" to (raw.html != null),
      "hasStream" to raw.hasStream,
      "textLenBucket" to lengthBucket(raw.text),
      "textIsSingleUrl" to (text != null && text.isNotEmpty() && safeMatch(isWebUrl, text)),
      "subjectLenBucket" to lengthBucket(raw.subject),
      "htmlLenBucket" to lengthBucket(raw.html),
      "clipItemCount" to bounded(raw.clipItemTotal, MAX_CLIP_ITEMS),
      "clipItems" to clipItems,
      "clipTextMatchesExtraText" to clipTextMatchesExtraText(raw.text, raw.clipItems),
      "otherExtraCount" to bounded(raw.otherExtraCount, MAX_OTHER_EXTRAS),
    )
  }

  private fun safeMatch(isWebUrl: (String) -> Boolean, text: String): Boolean =
    try {
      isWebUrl(text)
    } catch (_: Throwable) {
      false
    }
}
