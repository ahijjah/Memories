import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

const COLLAPSED_LINES = 12;
// Without measuring layout, text is treated as long when it has more lines than shown collapsed or
// enough characters to wrap past them.
const LONG_TEXT_CHARS = 700;

export function isLongMemoryBody(body: string): boolean {
  return body.split('\n').length > COLLAPSED_LINES || body.length > LONG_TEXT_CHARS;
}

/**
 * LOSSLESS-CAPTURE-01: the full text the user saved, exactly as stored. Read-only in this phase.
 * Renders nothing for Memories without saved text (including every older one).
 */
export function MemoryBodySection({ body, sourceType }: { body?: string | null; sourceType?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!body) return null;

  const long = isLongMemoryBody(body);
  return (
    <View testID="memory-body" className="mb-6 p-4 rounded-lg bg-gray-50 border border-gray-200">
      <Text className="text-xs font-semibold uppercase text-gray-500 mb-2">
        {sourceType === 'url' ? 'Shared with this link' : 'Your text'}
      </Text>
      <Text
        testID="memory-body-text"
        selectable
        numberOfLines={long && !expanded ? COLLAPSED_LINES : undefined}
        className="text-base text-gray-900"
      >
        {body}
      </Text>
      {long ? (
        <TouchableOpacity testID="memory-body-toggle" onPress={() => setExpanded((v) => !v)} className="mt-2 self-start">
          <Text className="text-blue-600 font-semibold">{expanded ? 'Show less' : 'Show more'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
