import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useAuth } from '@clerk/clerk-expo';
import { createMemory } from '@/src/api/client';
import CaptureScreen from '@/app/(tabs)/capture';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// LOSSLESS-CAPTURE-01: the Capture screen saves the full text or refuses it; never cuts it.
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
}));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}), { virtual: true });
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { Images: 'Images' } }), { virtual: true });
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('@/src/api/client', () => ({ createMemory: jest.fn() }));
jest.mock('@/src/utils/photo-upload', () => ({ uploadPhotoToMemory: jest.fn() }));

async function renderCapture() {
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(React.createElement(CaptureScreen));
  });
  return root;
}
const textInput = (root: TestRenderer.ReactTestRenderer) =>
  root.root.find((n) => (n.type as any) === 'TextInput' && n.props.placeholder === 'Enter text to remember...');
const texts = (root: TestRenderer.ReactTestRenderer) =>
  root.root.findAll((n) => (n.type as any) === 'Text').map((n) => [n.props.children].flat().join(''));

async function type(root: TestRenderer.ReactTestRenderer, value: string) {
  await act(async () => textInput(root).props.onChangeText(value));
}
async function save(root: TestRenderer.ReactTestRenderer) {
  await act(async () => {
    await root.root.findByProps({ testID: 'capture-save' }).props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ getToken: jest.fn().mockResolvedValue('token-1') });
  (createMemory as jest.Mock).mockResolvedValue({ id: 'mem-1' });
});

describe('Capture: text', () => {
  it('saves the full text as body, exactly as typed, with a short derived title', async () => {
    const value = `  First line of my note\n${'details '.repeat(100)}\nlast line  `;
    const root = await renderCapture();
    await type(root, value);
    await save(root);

    expect(createMemory).toHaveBeenCalledWith(
      'token-1', 'text', expect.any(String), undefined, 'First line of my note', undefined, undefined, value,
    );
    expect(mockRouter.push).toHaveBeenCalledWith('/memory/mem-1');
  });

  it('20,000 characters is saved whole', async () => {
    const value = 'a'.repeat(20_000);
    const root = await renderCapture();
    await type(root, value);
    await save(root);

    expect((createMemory as jest.Mock).mock.calls[0][7]).toBe(value);
  });

  it('20,001 characters: Save is disabled, the counter says why, and nothing is sent or cut', async () => {
    const root = await renderCapture();
    await type(root, 'a'.repeat(20_001));

    expect(root.root.findByProps({ testID: 'capture-save' }).props.disabled).toBe(true);
    expect(texts(root).join(' ')).toContain('20,001 / 20,000 — too long to save');

    await save(root); // even if pressed, the handler refuses
    expect(createMemory).not.toHaveBeenCalled();
    expect(texts(root).join(' ')).toContain('This text is too long to save (20,001 characters; the limit is 20,000). Nothing was saved.');
  });

  it('the counter appears only near the limit', async () => {
    const root = await renderCapture();
    await type(root, 'short note');
    expect(root.root.findAllByProps({ testID: 'capture-text-counter' })).toHaveLength(0);

    await type(root, 'a'.repeat(18_500));
    expect(texts(root).join(' ')).toContain('18,500 / 20,000');
    expect(root.root.findByProps({ testID: 'capture-save' }).props.disabled).toBe(false);
  });
});
