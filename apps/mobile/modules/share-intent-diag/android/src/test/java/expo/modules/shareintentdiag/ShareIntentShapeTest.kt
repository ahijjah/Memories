package expo.modules.shareintentdiag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareIntentShapeTest {
  // JVM stand-in for android.util.Patterns.WEB_URL (whole-string match).
  private val isWebUrl: (String) -> Boolean = { Regex("^https?://[^\\s]+$").matches(it) }

  private fun raw(
    action: String? = "android.intent.action.SEND",
    type: String? = "text/plain",
    text: CharSequence? = null,
    subject: CharSequence? = null,
    title: CharSequence? = null,
    html: CharSequence? = null,
    hasStream: Boolean = false,
    clipItems: List<RawClipItem>? = null,
    clipItemTotal: Int = clipItems?.size ?: 0,
    otherExtraCount: Int = 0,
  ) = RawShareIntent(action, type, text, subject, title, html, hasStream, clipItems, clipItemTotal, otherExtraCount)

  @Test fun lengthBuckets() {
    assertEquals("0", ShareIntentShape.lengthBucket(null))
    assertEquals("0", ShareIntentShape.lengthBucket(""))
    assertEquals("1-100", ShareIntentShape.lengthBucket("a"))
    assertEquals("1-100", ShareIntentShape.lengthBucket("a".repeat(100)))
    assertEquals("101-500", ShareIntentShape.lengthBucket("a".repeat(101)))
    assertEquals("101-500", ShareIntentShape.lengthBucket("a".repeat(500)))
    assertEquals(">500", ShareIntentShape.lengthBucket("a".repeat(501)))
  }

  @Test fun actionAndMimeCategory() {
    assertEquals("send", ShareIntentShape.action("android.intent.action.SEND"))
    assertEquals("send_multiple", ShareIntentShape.action("android.intent.action.SEND_MULTIPLE"))
    assertEquals("other", ShareIntentShape.action("android.intent.action.VIEW"))
    assertEquals("other", ShareIntentShape.action(null))
    assertEquals("text", ShareIntentShape.typeCategory("text/plain"))
    assertEquals("text", ShareIntentShape.typeCategory(" TEXT/HTML "))
    assertEquals("image", ShareIntentShape.typeCategory("image/jpeg"))
    assertEquals("other", ShareIntentShape.typeCategory("video/mp4"))
    assertEquals("other", ShareIntentShape.typeCategory("*/*"))
    assertEquals("other", ShareIntentShape.typeCategory(null))
  }

  @Test fun urlOnlyClassification() {
    val single = ShareIntentShape.summarize(raw(text = "https://www.facebook.com/share/p/SENTINEL/"), isWebUrl)
    assertEquals(true, single["textIsSingleUrl"])
    val withCaption = ShareIntentShape.summarize(raw(text = "Look at this https://www.facebook.com/share/p/X/"), isWebUrl)
    assertEquals(false, withCaption["textIsSingleUrl"])
    val trailingNewline = ShareIntentShape.summarize(raw(text = "https://www.facebook.com/share/p/X/\n"), isWebUrl)
    assertEquals(false, trailingNewline["textIsSingleUrl"])
    assertEquals(false, ShareIntentShape.summarize(raw(text = ""), isWebUrl)["textIsSingleUrl"])
    assertEquals(false, ShareIntentShape.summarize(raw(text = null), isWebUrl)["textIsSingleUrl"])
    // A throwing matcher is treated as "not a URL", never propagated.
    assertEquals(false, ShareIntentShape.summarize(raw(text = "x")) { throw IllegalStateException("boom") }["textIsSingleUrl"])
  }

  @Test fun clipDataSummaryAndCapping() {
    val items = List(25) { i -> RawClipItem(text = if (i % 2 == 0) "SENTINELCLIP$i" else null, hasUri = i % 3 == 0, htmlText = if (i == 0) "<b>SENTINEL</b>" else null) }
    val summary = ShareIntentShape.summarize(raw(clipItems = items, clipItemTotal = 25), isWebUrl)
    assertEquals(ShareIntentShape.MAX_CLIP_ITEMS, summary["clipItemCount"])
    @Suppress("UNCHECKED_CAST")
    val clip = summary["clipItems"] as List<Map<String, Any>>
    assertEquals(ShareIntentShape.MAX_CLIP_ITEMS, clip.size)
    assertEquals(mapOf("hasText" to true, "hasUri" to true, "hasHtml" to true), clip[0])
    assertEquals(mapOf("hasText" to false, "hasUri" to false, "hasHtml" to false), clip[1])
    assertEquals(0, ShareIntentShape.summarize(raw(clipItems = null), isWebUrl)["clipItemCount"])
    assertEquals(emptyList<Any>(), ShareIntentShape.summarize(raw(clipItems = null), isWebUrl)["clipItems"])
  }

  @Test fun extraCountCapping() {
    assertEquals(0, ShareIntentShape.summarize(raw(otherExtraCount = -5), isWebUrl)["otherExtraCount"])
    assertEquals(7, ShareIntentShape.summarize(raw(otherExtraCount = 7), isWebUrl)["otherExtraCount"])
    assertEquals(ShareIntentShape.MAX_OTHER_EXTRAS, ShareIntentShape.summarize(raw(otherExtraCount = 10_000), isWebUrl)["otherExtraCount"])
    assertEquals(ShareIntentShape.MAX_CLIP_ITEMS, ShareIntentShape.summarize(raw(clipItemTotal = Int.MAX_VALUE), isWebUrl)["clipItemCount"])
  }

  @Test fun presenceFlags() {
    val summary = ShareIntentShape.summarize(
      raw(text = "t", subject = "", title = "SENTINELTITLE", html = null, hasStream = true), isWebUrl,
    )
    assertEquals(true, summary["hasText"])
    assertEquals(true, summary["hasSubject"]) // present but empty
    assertEquals("0", summary["subjectLenBucket"])
    assertEquals(true, summary["hasTitle"])
    assertEquals(false, summary["hasHtml"])
    assertEquals(true, summary["hasStream"])
  }

  /** Adversarial: every raw field carries sentinel/private values; none may reach the output. */
  @Test fun noRawValueEverAppearsInOutput() {
    val hostile = listOf(
      "https://www.facebook.com/share/p/SENTINELTOKEN/?mibextid=SENTINELQUERY",
      "content://com.facebook.katana.provider/SENTINELURI/123456789",
      "SENTINEL caption with post 1234567890123 and user@example.com",
      "Bearer SENTINEL.eyJhbGciOi.SENTINEL",
      "<a href=\"https://SENTINELHOST/x\">SENTINELHTML</a>",
      "SENTINEL\n\r\u0000‮",
      "a".repeat(10_000) + "SENTINEL",
    )
    for (value in hostile) {
      val summary = ShareIntentShape.summarize(
        raw(
          action = value, type = value, text = value, subject = value, title = value, html = value, hasStream = true,
          clipItems = List(3) { RawClipItem(text = value, hasUri = true, htmlText = value) }, clipItemTotal = 3, otherExtraCount = 3,
        ),
        isWebUrl,
      )
      val rendered = summary.toString()
      assertFalse(rendered, rendered.contains("SENTINEL"))
      assertFalse(rendered, rendered.contains("facebook"))
      assertFalse(rendered, rendered.contains("content://"))
      assertFalse(rendered, rendered.contains("@"))
      assertFalse(rendered, rendered.contains("1234567890123"))
      assertStrictlySafe(summary)
    }
  }

  private val allowedStrings = setOf(
    "send", "send_multiple", "other", "text", "image", "0", "1-100", "101-500", ">500",
    "ok", "no_intent", "native_error",
  )

  private fun assertStrictlySafe(value: Any?) {
    when (value) {
      is Map<*, *> -> value.forEach { (k, v) ->
        assertTrue("unexpected key $k", k is String && k.matches(Regex("^[a-zA-Z]+$")))
        assertStrictlySafe(v)
      }
      is List<*> -> value.forEach { assertStrictlySafe(it) }
      is String -> assertTrue("unexpected string value", value in allowedStrings)
      is Boolean -> Unit
      is Int -> assertTrue(value in 0..50)
      else -> throw AssertionError("unexpected value type ${value?.javaClass}")
    }
  }

  @Test fun exactOutputKeys() {
    val keys = ShareIntentShape.summarize(raw(), isWebUrl).keys
    assertEquals(
      setOf(
        "action", "typeCategory", "hasText", "hasSubject", "hasTitle", "hasHtml", "hasStream",
        "textLenBucket", "textIsSingleUrl", "subjectLenBucket", "htmlLenBucket",
        "clipItemCount", "clipItems", "clipTextMatchesExtraText", "otherExtraCount",
      ),
      keys,
    )
  }

  // --- envelope: no_intent vs native_error ---

  @Test fun envelopeNoIntent() {
    assertEquals(mapOf("status" to "no_intent"), ShareIntentShape.envelope({ null }, isWebUrl))
  }

  @Test fun envelopeOkCarriesOnlyTheShape() {
    val env = ShareIntentShape.envelope({ raw(text = "https://x.example/SENTINEL") }, isWebUrl)
    assertEquals(setOf("status", "shape"), env.keys)
    assertEquals("ok", env["status"])
    assertStrictlySafe(env)
    assertFalse(env.toString().contains("SENTINEL"))
  }

  @Test fun envelopeNativeErrorCarriesNoExceptionData() {
    val hostileThrows = listOf<() -> RawShareIntent?>(
      { throw ClassNotFoundException("expo.modules.sharing.SENTINELCLASS https://www.facebook.com/share/p/SENTINEL/") },
      { throw IllegalStateException("SENTINEL user@example.com content://x/SENTINEL") },
      { throw object : RuntimeException() {
          override val message: String get() = "SENTINELMESSAGE"
          override fun toString(): String = "SENTINELTOSTRING"
        } },
      { throw StackOverflowError("SENTINELSTACK") },
    )
    for (load in hostileThrows) {
      val env = ShareIntentShape.envelope(load, isWebUrl)
      assertEquals(mapOf("status" to "native_error"), env)
      assertFalse(env.toString().contains("SENTINEL"))
    }
    // A failure while summarizing (e.g. a hostile CharSequence) is also native_error only.
    val hostileText = object : CharSequence {
      override val length: Int get() = throw IllegalStateException("SENTINELLENGTH")
      override fun get(index: Int): Char = throw IllegalStateException("SENTINEL")
      override fun subSequence(startIndex: Int, endIndex: Int): CharSequence = throw IllegalStateException("SENTINEL")
      override fun toString(): String = throw IllegalStateException("SENTINELTOSTRING")
    }
    assertEquals(mapOf("status" to "native_error"), ShareIntentShape.envelope({ raw(text = hostileText) }, isWebUrl))
  }

  // --- clipTextMatchesExtraText ---

  private val url = "https://www.facebook.com/share/p/SENTINEL/"
  private fun mirror(text: CharSequence?, vararg clipTexts: CharSequence?) =
    ShareIntentShape.summarize(raw(text = text, clipItems = clipTexts.map { RawClipItem(it, false, null) }), isWebUrl)["clipTextMatchesExtraText"]

  @Test fun mirrorExactSingleItemIsTrue() = assertEquals(true, mirror(url, url))

  @Test fun mirrorComparesContentNotIdentity() = assertEquals(true, mirror(StringBuilder(url), String(url.toCharArray())))

  @Test fun mirrorAllMatchingItemsIsTrue() = assertEquals(true, mirror(url, url, url, url))

  @Test fun mirrorOneDifferingItemIsFalse() {
    assertEquals(false, mirror(url, url, "$url extra caption"))
    assertEquals(false, mirror(url, url, ""))
    assertEquals(false, mirror(url, "$url "))
  }

  @Test fun mirrorItemsWithoutTextAreIgnoredButNeedAtLeastOneText() {
    assertEquals(false, mirror(url))
    assertEquals(false, mirror(url, null, null))
    assertEquals(true, mirror(url, null, url))
    val uriOnly = ShareIntentShape.summarize(raw(text = url, clipItems = listOf(RawClipItem(null, true, "<b>x</b>"))), isWebUrl)
    assertEquals(false, uriOnly["clipTextMatchesExtraText"])
  }

  @Test fun mirrorMissingOrEmptyExtraTextIsFalse() {
    assertEquals(false, mirror(null, url))
    assertEquals(false, mirror("", ""))
    assertEquals(false, mirror(null))
  }

  @Test fun mirrorChecksItemsBeyondTheReportedCap() {
    val items = List(15) { RawClipItem(url, false, null) } + RawClipItem("different", false, null)
    val summary = ShareIntentShape.summarize(raw(text = url, clipItems = items, clipItemTotal = items.size), isWebUrl)
    assertEquals(false, summary["clipTextMatchesExtraText"])
    assertEquals(ShareIntentShape.MAX_CLIP_ITEMS, (summary["clipItems"] as List<*>).size)
  }

  @Test fun mirrorNeverReturnsEitherText() {
    val secret = "SENTINEL caption 1234567890123 user@example.com https://www.facebook.com/share/p/SENTINEL/"
    for (clip in listOf(secret, "SENTINELOTHER")) {
      val env = ShareIntentShape.envelope({ raw(text = secret, clipItems = listOf(RawClipItem(clip, true, clip))) }, isWebUrl)
      val rendered = env.toString()
      assertFalse(rendered, rendered.contains("SENTINEL"))
      assertFalse(rendered, rendered.contains("1234567890123"))
      assertStrictlySafe(env)
    }
  }
}
