import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActionMenuModal } from '../ActionMenuModal';

const mockPlatform = { OS: 'android' };

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    View: 'View',
    Text: 'Text',
    ScrollView: 'ScrollView',
    Pressable: 'Pressable',
    TouchableOpacity: 'TouchableOpacity',
    Modal: ({ visible, children, ...rest }: any) =>
      visible ? mockReact.createElement('Modal', rest, children) : null,
    get Platform() {
      return mockPlatform;
    },
  };
});

const render = (element: React.ReactElement) => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(element);
  });
  return r;
};

const textOf = (node: TestRenderer.ReactTestInstance): string =>
  node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

const pressLabel = (root: TestRenderer.ReactTestInstance, label: string) => {
  const target = root.findAll((n) => n.type === 'TouchableOpacity' && textOf(n) === label);
  expect(target).toHaveLength(1);
  act(() => target[0].props.onPress());
};

describe('ActionMenuModal', () => {
  beforeEach(() => {
    mockPlatform.OS = 'android';
  });

  it('renders nothing when not visible', () => {
    const r = render(
      <ActionMenuModal visible={false} items={[{ key: 'a', label: 'Alpha', onPress: jest.fn() }]} onClose={jest.fn()} />,
    );
    expect(r.root.findAll((n) => n.type === 'Text' && textOf(n) === 'Alpha')).toHaveLength(0);
  });

  it('renders every item when visible', () => {
    const r = render(
      <ActionMenuModal
        visible
        items={[
          { key: 'a', label: 'Alpha', onPress: jest.fn() },
          { key: 'b', label: 'Beta', onPress: jest.fn() },
        ]}
        onClose={jest.fn()}
      />,
    );
    const labels = r.root.findAll((n) => n.type === 'TouchableOpacity').map(textOf);
    expect(labels).toEqual(['Alpha', 'Beta', 'Cancel']);
  });

  it('closes the modal and then invokes the selected action', () => {
    const calls: string[] = [];
    const onClose = jest.fn(() => calls.push('close'));
    const onPress = jest.fn(() => calls.push('action'));
    const r = render(
      <ActionMenuModal visible items={[{ key: 'a', label: 'Alpha', onPress }]} onClose={onClose} />,
    );
    pressLabel(r.root, 'Alpha');
    expect(calls).toEqual(['close', 'action']);
  });

  it('defers the action to onDismiss on iOS and runs it exactly once', () => {
    mockPlatform.OS = 'ios';
    const onPress = jest.fn();
    const r = render(
      <ActionMenuModal visible items={[{ key: 'a', label: 'Alpha', onPress }]} onClose={jest.fn()} />,
    );
    pressLabel(r.root, 'Alpha');
    expect(onPress).not.toHaveBeenCalled();
    const modal = r.root.findByType('Modal' as any);
    act(() => modal.props.onDismiss());
    act(() => modal.props.onDismiss());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Cancel, backdrop and hardware back close without invoking any action', () => {
    const onClose = jest.fn();
    const onPress = jest.fn();
    const r = render(
      <ActionMenuModal visible items={[{ key: 'a', label: 'Alpha', onPress }]} onClose={onClose} />,
    );
    pressLabel(r.root, 'Cancel');
    act(() => r.root.findByProps({ accessibilityLabel: 'Close menu' }).props.onPress());
    act(() => r.root.findByType('Modal' as any).props.onRequestClose());
    act(() => r.root.findByType('Modal' as any).props.onDismiss());
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('marks disabled items as disabled', () => {
    const r = render(
      <ActionMenuModal visible items={[{ key: 'a', label: 'Alpha', onPress: jest.fn(), disabled: true }]} onClose={jest.fn()} />,
    );
    const item = r.root.findAll((n) => n.type === 'TouchableOpacity' && textOf(n) === 'Alpha')[0];
    expect(item.props.disabled).toBe(true);
  });
});
