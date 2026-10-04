/* the transport, in Node — does a rewind actually end?
 *
 *   node tools/_rew.mjs
 *
 * WHY THIS EXISTS
 * `mode = 'rew'` is entered in exactly one place (`ended`) and left in exactly
 * one place (the loop, when `cas.st.dir === -1`). `dir` is written in two other
 * places — `ended` writes +1, `seekTo` writes −1 — and **nothing walked +1 back
 * to −1** once the tape transport left with `cassette.js`. So the exit never
 * fired and the page stayed in the rewind forever: measured in the browser
 * (`tools/_singtrace.mjs`), `sing` decayed to zero and stopped there, i.e. she
 * never sang again after a song finished.
 *
 * The browser is the right place to check the *integration* (that the loop's
 * exit fires and she resumes), but it is the wrong place to check the *clock*:
 * at ~1 fps a 8.5-page-second rewind is 170 frames and 2½ minutes of wall time,
 * and a failure looks like a timeout rather than a number. `relic.js` imports
 * only `three`, and `createRelic()` builds meshes and geometries but needs no
 * GL context — so the whole transport runs here, deterministically, in
 * milliseconds. Same move as reproducing a geometry in Node instead of guessing
 * at it from a screenshot.
 *
 * The discriminating assertion is `dir` reaching −1 at all. Before the fix it
 * could not: `time` would sit at `duration` and `dir` at +1 forever. A test that
 * only checked "time went down" would have passed on a rewind that never ended.
 */
import { createRelic } from '../src/relic.js';

const DT = 1 / 20;                 // the loop's own cap (main.js: `Math.min(..., 1/20)`)
const REW_SECONDS = 8.5;

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('  FAIL  ' + msg); } else console.log('  ok    ' + msg); };

/** run the transport for at most `maxFrames`, stopping the moment `dir` flips */
function rewind({ duration, time, dir = 1, maxFrames = 4000 }) {
  const cas = createRelic({ floorY: -1.62 });
  cas.st.duration = duration;
  cas.st.time = time;
  cas.st.dir = dir;
  cas.st.playing = true;
  cas.st.driven = false;            // the loop clears this every frame while in 'rew'
  let frames = 0;
  let prev = cas.st.time;
  let monotone = true;
  while (frames < maxFrames && cas.st.dir === 1) {
    cas.update(DT);
    if (cas.st.time > prev) monotone = false;
    prev = cas.st.time;
    frames++;
  }
  return { cas, frames, monotone, seconds: frames * DT };
}

console.log('A. rewind, a 60 s side');
{
  const r = rewind({ duration: 60, time: 60 });
  console.log(`  dir ${r.cas.st.dir}   time ${r.cas.st.time.toFixed(4)}   ${r.frames} frames = ${r.seconds.toFixed(2)} page s`);
  ok(r.cas.st.dir === -1, '`dir` came back to −1 — the loop\'s exit can fire');
  ok(r.cas.st.time === 0, '`st.time` landed exactly on 0 (counter reads 00:00)');
  ok(Math.abs(r.seconds - REW_SECONDS) < DT * 1.5, `it took ${r.seconds.toFixed(2)} page s ≈ REW_SECONDS (${REW_SECONDS})`);
  ok(r.monotone, '`st.time` never went up on the way back');
}

console.log('B. rewind is independent of the side\'s length');
{
  const a = rewind({ duration: 60, time: 60 });
  const b = rewind({ duration: 317, time: 317 });
  console.log(`  60 s → ${a.frames} frames   317 s → ${b.frames} frames`);
  /* ±1 frame, not exact: the frame count is `ceil(duration / (duration/REW_SECONDS*DT))`,
     which is 170 on paper but lands on 171 or 170 depending on how the float
     division rounds. Asserting equality here would be asserting float noise. */
  ok(Math.abs(a.frames - b.frames) <= 1, 'both sides spool back in the same number of frames (±1)');
}

console.log('C. forward, no audio to be driven by (the 「她只做口型」 path)');
{
  const cas = createRelic({ floorY: -1.62 });
  cas.st.duration = 60; cas.st.time = 0; cas.st.playing = true; cas.st.driven = false;
  for (let i = 0; i < 1200; i++) cas.update(DT);      // 60 page s
  console.log(`  dir ${cas.st.dir}   time ${cas.st.time.toFixed(3)}`);
  ok(cas.st.dir === -1, 'a fresh `relic` starts in forward, not in rewind');
  ok(Math.abs(cas.st.time - 60) < 1e-9, '`st.time` ran forward and clamped at `duration`');
}

console.log('D. degenerate durations must still terminate (no NaN trap)');
{
  const z = rewind({ duration: 0, time: 0 });
  const n = rewind({ duration: NaN, time: NaN });
  console.log(`  duration 0 → ${z.frames} frame(s), dir ${z.cas.st.dir}   ·   NaN → ${n.frames} frame(s), dir ${n.cas.st.dir}`);
  ok(z.cas.st.dir === -1 && z.frames <= 1, 'duration 0 completes immediately');
  ok(n.cas.st.dir === -1 && n.frames <= 1, 'NaN duration completes immediately rather than dividing to NaN');
}

console.log(bad ? `\nFAIL  ${bad} assertion(s)` : '\nPASS  the transport always leaves the rewind');
process.exit(bad ? 1 : 0);
