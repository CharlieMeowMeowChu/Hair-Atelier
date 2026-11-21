import { performance } from 'node:perf_hooks';
import { createDemoHairState, HairEditor } from '../src/hair-core';
import { fullHairSamples } from '../src/visible-hair';
import { buildVisibleRibbon } from '../src/visible-ribbon';
const head = { center: [0, 0, 0] as const, radii: [0.22, 0.2464, 0.2024] as const, clearance: 0.018 };
for (const long of [false, true]) {
  const editor = new HairEditor(createDemoHairState());
  editor.curlRange('C', { startS: 0.04, endS: 0.4, radius: 0.025, pitch: 0.08, phase: 0.3, direction: 1 });
  if (long) editor.growBy('C', 1.6);
  const strand = editor.exportState().strands.find((s) => s.id === 'C')!;
  const times: number[] = []; let count = 0;
  for (let i = 0; i < 40; i++) { const start = performance.now(); const samples = fullHairSamples(strand, head); buildVisibleRibbon(samples, strand.length, 0.006, head); const elapsed = performance.now() - start; count = samples.length; if (i >= 10) times.push(elapsed); }
  times.sort((a, b) => a - b);
  process.stdout.write(JSON.stringify({length: strand.length, samples: count, medianMs: times[15], p95Ms: times[28]}) + '\n');
}
