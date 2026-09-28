/* ============================ picture from sound ========================

   Three things in the frame are driven by the music rather than by a clock:
   the four bars beside the track name, how fast the dust drifts, and how hard
   the bloom is pushed. They all read one envelope, so they can never disagree
   about where the beat is.

   The envelope comes from one of two places, and in the ordinary case neither
   is a live AnalyserNode. A side of the demo tape was synthesised in this page,
   so its four bands are already computed — one byte per band per frame, sixty
   frames a second, for the whole sixty seconds (see demo-audio.js). That is
   exact, it costs nothing here, and it is the only thing that works from
   file://, where a media element cannot be routed into Web Audio at all.

   A file the visitor brought is the other case: it was not synthesised here, so
   it has to be listened to. That needs a MediaElementSource, which file://
   refuses; the attempt is made once and its failure is a fallback rather than a
   retry. So the bars always move — they just move on their own when there is
   nothing to follow.
   ====================================================================== */

import { FPS } from './demo-audio.js';
import { sideOf } from './playlist.js';

/* How fast the bars chase the envelope, in e-folds a second. The offline
   analysis is already per-frame, so this is here only to stop a byte boundary
   from reading as a step. */
const CHASE = 16;

/* The bars' own floor and ceiling, in rem: the numbers styles.css gives .eq and
   .eq i, because this writes inline heights that have to agree with the ones
   the keyframe animates between. */
const BAR_MIN = 0.1875, BAR_MAX = 0.6875;

/* The splits an analyser's bins are read through, in Hz — the same three the
   offline analysis uses, plus a fourth edge whose only job is to stop the top
   band from averaging eight kilohertz of near-silence into its own reading. */
const EDGE_HZ = [20, 160, 500, 2000, 8000];

/* An analyser's ceiling is 255 and a mastered file rarely reaches it, so without
   this the bars would spend their life in the bottom third. It is not a volume
   control: it is what makes a loud record and a quiet one read the same. */
const MEDIA_TRIM = 0.62;

/* How fast the bloom's baseline follows the low end, in e-folds a second, and
   how far the beat may swing it. The bloom wants the *movement*, not the level:
   a band that sits at 0.6 all day would push the glow up and simply leave it
   there, so the slow average is the baseline and only the part that rises above
   it is allowed to move the picture. Half a second is long enough to survive a
   kick and short enough to catch the next one. */
const BLOOM_FOLLOW = 2, BLOOM_SWING = 0.55, BLOOM_MIN = 0.85, BLOOM_MAX = 1.30;

/** `bars` is the four <i> inside #now .eq, in band order — low to high. */
export function createViz(bars) {
  const lv = new Float32Array(4);       // smoothed — what the picture sees
  const raw = new Float32Array(4);      // one frame, straight off the source
  let media = null, bins = null, tried = false;
  let url = null, side = null;
  let avg = 0, beat = 1;                // the bloom's baseline, and what it reads

  /** Route the visitor's own file through an analyser. Returns false when the
      browser will not have it — file://, a cross-origin file, no Web Audio —
      and stays quiet from then on rather than retrying every load. */
  function listen(el, tape) {
    if (tried) return !!media;
    tried = true;
    const an = tape.attachMedia(el);
    if (!an) return false;
    media = an;
    bins = new Uint8Array(an.frequencyBinCount);
    return true;
  }

  /** four bands, 0..1, out of the analysis the tape was born with */
  function readSide(t) {
    const a = side.analysis;
    const f = Math.min((t * FPS) | 0, (a.length >> 2) - 1);
    const o = f << 2;
    raw[0] = a[o] / 255; raw[1] = a[o + 1] / 255;
    raw[2] = a[o + 2] / 255; raw[3] = a[o + 3] / 255;
  }

  /** four bands, 0..1, out of a live analyser */
  function readMedia() {
    media.getByteFrequencyData(bins);
    const n = bins.length;
    const per = media.context.sampleRate / (n * 2);       // Hz per bin
    let lo = Math.max(1, Math.round(EDGE_HZ[0] / per));
    for (let k = 0; k < 4; k++) {
      const hi = Math.max(lo + 1, Math.min(n, Math.round(EDGE_HZ[k + 1] / per)));
      let s = 0;
      for (let i = lo; i < hi; i++) s += bins[i];
      raw[k] = Math.min(1, s / (hi - lo) / 255 / MEDIA_TRIM);
      lo = hi;
    }
  }

  /** One frame. `live` is whether the tape is actually rolling; when it is not,
      everything falls back to rest and the bars are handed back to the
      stylesheet, which is what puts the keyframe animation back on them. */
  function update(dt, el, live) {
    const src = el.currentSrc || el.src;
    if (src !== url) { url = src; side = sideOf(src); }
    let ok = false;
    if (live) {
      if (side?.analysis) { readSide(el.currentTime); ok = true; }
      else if (media) { readMedia(); ok = true; }
    }
    const k = 1 - Math.exp(-CHASE * dt);
    for (let i = 0; i < 4; i++) lv[i] += ((ok ? raw[i] : 0) - lv[i]) * k;
    /* the bloom rides the low end, but only the part of it above its own slow
       average — a level meter is not what a glow wants to be */
    avg += (lv[0] - avg) * (1 - Math.exp(-BLOOM_FOLLOW * dt));
    const b = 1 + BLOOM_SWING * (lv[0] - avg);
    beat = b < BLOOM_MIN ? BLOOM_MIN : b > BLOOM_MAX ? BLOOM_MAX : b;
    /* the class is what takes the keyframe loop away, so it is on only while
       there is something to follow — no source, no class, bars keep moving */
    document.body.classList.toggle('eq-live', ok);
    if (ok) {
      for (let i = 0; i < 4; i++) {
        bars[i].style.height = (BAR_MIN + lv[i] * (BAR_MAX - BAR_MIN)).toFixed(4) + 'rem';
      }
    } else if (bars[0].style.height) {
      for (const b of bars) b.style.height = '';
    }
    return lv;
  }

  return {
    listen, update,
    /** what the bloom should be multiplied by this frame, 1 being the room's
        own value — see main.js's applyTheme() */
    get beat() { return beat; },
  };
}
