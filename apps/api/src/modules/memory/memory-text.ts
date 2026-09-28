import { ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

/**
 * Maximum length of the full text a user saves with a Memory (LOSSLESS-CAPTURE-01). Longer text
 * is rejected, never truncated. The mobile app enforces the same value before sending, and the
 * database has a CHECK with the same bound as a backstop.
 */
export const MAX_MEMORY_TEXT = 20_000;

/**
 * Length in Unicode code points, which is what PostgreSQL char_length() counts for UTF-8 text.
 * (class-validator's MaxLength discounts variation selectors, so it could accept text that the
 * database CHECK then rejects.)
 */
export function memoryTextLength(text: string): number {
  return Array.from(text).length;
}

export function IsMemoryText(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isMemoryText',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && memoryTextLength(value) <= MAX_MEMORY_TEXT,
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property must be text of at most ${MAX_MEMORY_TEXT} characters`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
