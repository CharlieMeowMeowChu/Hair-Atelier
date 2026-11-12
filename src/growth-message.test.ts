import { expect, it } from 'vitest';
import { createDemoHairState, HairEditor } from './hair-core';
import { growthMessage } from './growth-message';

it('reports the actual growth near the limit, then reports that the limit was reached', () => {
  const editor = new HairEditor(createDemoHairState());
  expect(editor.growBy('C', 0.18).changed).toBe(true);
  const partial = editor.growBy('C', 0.05);
  expect(growthMessage(partial)).toBe('已對 C 增長 2 cm');
  const atLimit = editor.growBy('C', 0.05);
  expect(atLimit.changed).toBe(false);
  expect(growthMessage(atLimit)).toBe('C 已達可增長的上限');
  editor.undo();
  expect(editor.exportState().strands.find((strand) => strand.id === 'C')?.length).toBeCloseTo(0.58);
});
