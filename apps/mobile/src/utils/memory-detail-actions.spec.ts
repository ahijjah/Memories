import { splitDetailActions } from './memory-detail-actions';
import { MemoryAction } from './memory-actions';

const a = (label: string, kind: MemoryAction['kind']): MemoryAction => ({ label, kind });

describe('splitDetailActions', () => {
  it('selects calendar over maps, openUrl and ask', () => {
    const { primary, secondary } = splitDetailActions([
      a('Ask About This', 'ask'),
      a('Open Product', 'openUrl'),
      a('Open Location', 'maps'),
      a('Add to Calendar', 'calendar'),
    ]);
    expect(primary?.label).toBe('Add to Calendar');
    expect(secondary.map((x) => x.label)).toEqual(['Ask About This', 'Open Product', 'Open Location']);
  });

  it('falls back through maps, openUrl, then ask', () => {
    expect(splitDetailActions([a('Open Map', 'maps'), a('Ask About This', 'ask')]).primary?.label).toBe('Open Map');
    expect(splitDetailActions([a('Compare', 'compare'), a('Open Product', 'openUrl')]).primary?.label).toBe('Open Product');
    expect(splitDetailActions([a('Summarize', 'summarize'), a('Ask About This', 'ask')]).primary?.label).toBe('Ask About This');
  });

  it('selects Expiry Reminder (calendar kind) as primary', () => {
    const { primary, secondary } = splitDetailActions([a('Share Copy', 'share'), a('Expiry Reminder', 'calendar')]);
    expect(primary?.label).toBe('Expiry Reminder');
    expect(secondary.map((x) => x.label)).toEqual(['Share Copy']);
  });

  it('returns no primary when no contextual action exists', () => {
    const { primary, secondary } = splitDetailActions([a('Call', 'call'), a('WhatsApp', 'whatsapp'), a('Share Event', 'share')]);
    expect(primary).toBeNull();
    expect(secondary.map((x) => x.label)).toEqual(['Call', 'WhatsApp', 'Share Event']);
  });

  it('drops placeholder and duplicate-collection actions', () => {
    const { primary, secondary } = splitDetailActions([
      a('Save for Trip', 'comingSoon'),
      a('Related Memories', 'comingSoon'),
      a('Save for Later', 'collection'),
      a('Compare', 'compare'),
    ]);
    expect(primary).toBeNull();
    expect(secondary.map((x) => x.label)).toEqual(['Compare']);
  });

  it('never selects Call, WhatsApp, Share, Summarize, Key Points or Compare as primary', () => {
    const { primary } = splitDetailActions([
      a('Call', 'call'),
      a('WhatsApp', 'whatsapp'),
      a('Share Place', 'share'),
      a('Summarize', 'summarize'),
      a('Key Points', 'keyPoints'),
      a('Compare', 'compare'),
    ]);
    expect(primary).toBeNull();
  });
});
