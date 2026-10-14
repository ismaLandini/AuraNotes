import { describe, expect, it, vi } from 'vitest';
import { dispatchKey, formatCombo, matches, registerShortcuts } from './registry';

function key(init: KeyboardEventInit & { target?: EventTarget }) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.target) Object.defineProperty(e, 'target', { value: init.target });
  return e;
}

describe('shortcut matching', () => {
  it('uses ⌘ as the primary modifier on macOS and Ctrl elsewhere', () => {
    expect(matches(key({ key: 'z', code: 'KeyZ', metaKey: true }), 'mod+z', true)).toBe(true);
    expect(matches(key({ key: 'z', code: 'KeyZ', ctrlKey: true }), 'mod+z', true)).toBe(false);
    expect(matches(key({ key: 'z', code: 'KeyZ', ctrlKey: true }), 'mod+z', false)).toBe(true);
  });
  it('distinguishes shift for letters', () => {
    expect(matches(key({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }), 'mod+z', true)).toBe(false);
    expect(matches(key({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }), 'mod+shift+z', true)).toBe(true);
  });
  it('ignores shift for symbols that need it on some layouts (⌘/ on Italian keyboards)', () => {
    expect(matches(key({ key: '/', code: 'Digit7', metaKey: true, shiftKey: true }), 'mod+/', true)).toBe(true);
  });
  it('resolves Option-modified letters through the physical key', () => {
    expect(matches(key({ key: '˜', code: 'KeyN', metaKey: true, altKey: true }), 'mod+alt+n', true)).toBe(true);
  });
  it('handles zoom aliases', () => {
    expect(matches(key({ key: '=', code: 'Equal', metaKey: true }), 'mod+plus', true)).toBe(true);
    expect(matches(key({ key: '+', code: 'BracketRight', metaKey: true }), 'mod+plus', true)).toBe(true);
    expect(matches(key({ key: '-', code: 'Minus', metaKey: true }), 'mod+minus', true)).toBe(true);
  });
  it('formats combos for display', () => {
    expect(formatCombo('mod+shift+z')).toMatch(/Z/);
  });
});

describe('dispatching', () => {
  it('does not fire canvas shortcuts while typing, but fires global ones', () => {
    const canvasRun = vi.fn();
    const globalRun = vi.fn();
    const off = registerShortcuts([
      { id: 't-del', keys: ['backspace'], label: 'x', category: 'Canvas', scope: 'canvas', run: canvasRun },
      { id: 't-save', keys: ['mod+s'], label: 'y', category: 'Canvas', scope: 'global', run: globalRun },
    ]);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);

    expect(dispatchKey(key({ key: 'Backspace', target: editable }), { modalOpen: false })).toBe(false);
    expect(canvasRun).not.toHaveBeenCalled();
    expect(dispatchKey(key({ key: 'Backspace', target: document.body }), { modalOpen: false })).toBe(true);
    expect(canvasRun).toHaveBeenCalledTimes(1);

    const mod = navigator.platform.includes('Mac') ? { metaKey: true } : { ctrlKey: true };
    expect(dispatchKey(key({ key: 's', code: 'KeyS', ...mod, target: editable }), { modalOpen: false })).toBe(true);
    expect(globalRun).toHaveBeenCalledTimes(1);
    off();
  });

  it('suspends shortcuts while a dialog is open unless allowed', () => {
    const run = vi.fn();
    const runModal = vi.fn();
    const off = registerShortcuts([
      { id: 'a', keys: ['x'], label: 'a', category: 'Canvas', scope: 'canvas', run },
      { id: 'b', keys: ['escape'], label: 'b', category: 'Canvas', scope: 'canvas', run: runModal, inModal: true },
    ]);
    dispatchKey(key({ key: 'x', code: 'KeyX', target: document.body }), { modalOpen: true });
    dispatchKey(key({ key: 'Escape', target: document.body }), { modalOpen: true });
    expect(run).not.toHaveBeenCalled();
    expect(runModal).toHaveBeenCalled();
    off();
  });

  it('lets a handler decline so the event continues', () => {
    const off = registerShortcuts([{ id: 'c', keys: ['q'], label: 'c', category: 'Canvas', scope: 'canvas', run: () => false }]);
    const e = key({ key: 'q', code: 'KeyQ', target: document.body });
    expect(dispatchKey(e, { modalOpen: false })).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    off();
  });
});
