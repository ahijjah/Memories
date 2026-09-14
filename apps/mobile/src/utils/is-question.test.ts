import { isQuestion } from './is-question';

describe('isQuestion', () => {
  it('should return true for queries ending with ?', () => {
    expect(isQuestion('What is this?')).toBe(true);
    expect(isQuestion('Who are you?')).toBe(true);
    expect(isQuestion('Is this a test?')).toBe(true);
    expect(isQuestion('?')).toBe(true);
  });

  it('should return true for queries starting with question words', () => {
    expect(isQuestion('What is happening')).toBe(true);
    expect(isQuestion('what time is it')).toBe(true);
    expect(isQuestion('Who did this')).toBe(true);
    expect(isQuestion('When will it happen')).toBe(true);
    expect(isQuestion('Where are we')).toBe(true);
    expect(isQuestion('Why is this happening')).toBe(true);
    expect(isQuestion('How do I do this')).toBe(true);
    expect(isQuestion('Did you see that')).toBe(true);
    expect(isQuestion('Do you know')).toBe(true);
    expect(isQuestion('Does this work')).toBe(true);
    expect(isQuestion('Is this correct')).toBe(true);
    expect(isQuestion('Are you ready')).toBe(true);
    expect(isQuestion('Can you help')).toBe(true);
    expect(isQuestion('Will it happen')).toBe(true);
    expect(isQuestion('Should I do this')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(isQuestion('WHAT IS THIS')).toBe(true);
    expect(isQuestion('What is this')).toBe(true);
    expect(isQuestion('what is this')).toBe(true);
    expect(isQuestion('WhAt Is ThIs')).toBe(true);
  });

  it('should handle whitespace correctly', () => {
    expect(isQuestion('  what is this  ')).toBe(true);
    expect(isQuestion('\twhen will it happen\t')).toBe(true);
    expect(isQuestion('  why?  ')).toBe(true);
  });

  it('should return false for non-question queries', () => {
    expect(isQuestion('This is a statement')).toBe(false);
    expect(isQuestion('Tell me about this')).toBe(false);
    expect(isQuestion('I want to know')).toBe(false);
    expect(isQuestion('Show me results')).toBe(false);
    expect(isQuestion('remember this')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isQuestion('')).toBe(false);
    expect(isQuestion('   ')).toBe(false);
  });

  it('should return true for question starting with question words followed by punctuation', () => {
    expect(isQuestion('What? This is odd')).toBe(true);
    expect(isQuestion('Who, me?')).toBe(true);
  });

  it('should return false if question word appears but not at start', () => {
    expect(isQuestion('Tell me what you know')).toBe(false);
    expect(isQuestion('I want to know when')).toBe(false);
    expect(isQuestion('This is why I came')).toBe(false);
  });
});
