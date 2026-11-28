import { describe, expect, it } from 'vitest';
import { createDemoHairState, HairEditor, parseEditorHistory, type EditorHistory, type HairState } from './hair-core';

function stateAt(index: number): HairState {
  const state = createDemoHairState();
  return { ...state, strands: state.strands.map((strand) => strand.id === 'C' ? { ...strand, length: (10 + index) / 100 } : strand) };
}

function acceptedFullHistory(): EditorHistory {
  const stored = {
    version: 4,
    current: stateAt(20),
    // The next redo is the last entry, so store future states in reverse.
    undo: Array.from({ length: 20 }, (_, index) => stateAt(index)),
    redo: Array.from({ length: 20 }, (_, index) => stateAt(40 - index)),
  };
  const parsed = parseEditorHistory(JSON.stringify(stored));
  expect(parsed).toBeDefined();
  return parsed!;
}

function reload(editor: HairEditor): HairEditor {
  const exported = editor.exportHistory();
  const parsed = parseEditorHistory(JSON.stringify(exported));
  expect(parsed).toEqual(exported);
  return new HairEditor(parsed!.current, parsed!);
}

describe('previously accepted history with 20 undo and 20 redo snapshots', () => {
  it('undoes into a 21-entry redo stack without dropping history', () => {
    const original = acceptedFullHistory();
    const editor = new HairEditor(original.current, original);
    editor.undo();
    const after = editor.exportHistory();
    expect(after.current).toEqual(stateAt(19));
    expect(after.undo).toEqual(original.undo.slice(0, -1));
    expect(after.redo).toEqual([...original.redo, original.current]);
    expect(after.redo).toHaveLength(21);
    const reopened = reload(editor);
    reopened.redo();
    expect(reopened.exportHistory()).toEqual(original);
  });

  it('redoes into a 21-entry undo stack without dropping history', () => {
    const original = acceptedFullHistory();
    const editor = new HairEditor(original.current, original);
    editor.redo();
    const after = editor.exportHistory();
    expect(after.current).toEqual(stateAt(21));
    expect(after.undo).toEqual([...original.undo, original.current]);
    expect(after.redo).toEqual(original.redo.slice(0, -1));
    expect(after.undo).toHaveLength(21);
    const reopened = reload(editor);
    reopened.undo();
    expect(reopened.exportHistory()).toEqual(original);
  });

  it('retains every snapshot through both full 40-step traversals and reloads', () => {
    const original = acceptedFullHistory();
    let editor = new HairEditor(original.current, original);
    for (let i = 19; i >= 0; i -= 1) { editor.undo(); expect(editor.exportState()).toEqual(stateAt(i)); }
    expect(editor.exportHistory().redo).toHaveLength(40);
    editor = reload(editor);
    for (let i = 1; i <= 40; i += 1) { editor.redo(); expect(editor.exportState()).toEqual(stateAt(i)); }
    expect(editor.exportHistory().undo).toHaveLength(40);
    editor = reload(editor);
    for (let i = 39; i >= 0; i -= 1) { editor.undo(); expect(editor.exportState()).toEqual(stateAt(i)); }
    editor = reload(editor);
    for (let i = 1; i <= 20; i += 1) { editor.redo(); expect(editor.exportState()).toEqual(stateAt(i)); }
    expect(editor.exportHistory()).toEqual(original);
  });

  it('rejects more than 40 combined snapshots and accepts 40 on one side', () => {
    const original = acceptedFullHistory();
    const forty = { ...original, undo: [...original.undo, ...original.redo], redo: [] };
    expect(parseEditorHistory(JSON.stringify(forty))).toEqual(forty);
    expect(parseEditorHistory(JSON.stringify({ ...forty, redo: [stateAt(0)] }))).toBeUndefined();
    expect(parseEditorHistory(JSON.stringify({ ...forty, undo: [...forty.undo, stateAt(0)] }))).toBeUndefined();
    expect(() => new HairEditor(original.current, { undo: forty.undo, redo: [stateAt(0)] })).toThrow();
  });

  it('does not relax older history formats with oversized single stacks', () => {
    for (const version of [1, 2, 3]) {
      const snapshot = { ...stateAt(20), schemaVersion: version };
      const legacy = { version, current: snapshot, undo: Array(20).fill(snapshot), redo: [] };
      expect(parseEditorHistory(JSON.stringify(legacy))).toBeDefined();
      expect(parseEditorHistory(JSON.stringify({ ...legacy, undo: [...legacy.undo, snapshot] }))).toBeUndefined();
    }
  });

  it('continues to retain the latest 20 undo steps for ordinary edits', () => {
    const editor = new HairEditor(createDemoHairState());
    for (let index = 1; index <= 30; index += 1) {
      expect(editor.cutAt('C', 0.4 - index * 0.005).changed).toBe(true);
    }
    const history = editor.exportHistory();
    expect(history.undo).toHaveLength(20);
    expect(history.redo).toHaveLength(0);
    expect(parseEditorHistory(JSON.stringify(history))).toEqual(history);
    for (let index = 0; index < 20; index += 1) editor.undo();
    expect(editor.canUndo).toBe(false);
    expect(editor.exportHistory().redo).toHaveLength(20);
  });

  it('keeps an expanded undo history valid when making a new edit', () => {
    const original = acceptedFullHistory();
    const editor = new HairEditor(original.current, original);
    for (let i = 0; i < 20; i += 1) editor.redo();
    const before = editor.exportHistory();
    expect(before.undo).toHaveLength(40);
    expect(editor.cutAt('C', 0.2).changed).toBe(true);
    const after = editor.exportHistory();
    expect(after.undo).toEqual([...before.undo.slice(1), before.current]);
    expect(after.redo).toHaveLength(0);
    expect(parseEditorHistory(JSON.stringify(after))).toEqual(after);
  });
});
