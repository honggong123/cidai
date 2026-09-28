/* ============================ demo audio ===============================

   The repository ships no music: `assets/` is ignored, and the record this page
   was built around is a commercial release. So the tape carries a score it can
   render for itself — sixty seconds a side, two sides.

   Rendering to a WAV blob rather than routing a live graph into the speakers is
   deliberate. Everything downstream already speaks to an <audio> element —
   whenPlayable(), the duration, the seek rail, the counter, the label bake, the
   per-track chip — and a blob URL is a track all of that understands for free.

   The same pass hands back a four-band envelope at 60 fps, which is what the
   level meter reads. That matters because the media element's own audio cannot
   be tapped under file:// (see the README's note on the level meter that was
   rolled back): an envelope computed from samples we already own sidesteps the
   whole question.

   ---------------------------------------------------------------------------
   WHY THIS IS PLAIN DSP AND NOT AN OfflineAudioContext GRAPH

   The first cut of this file built the score out of Web Audio nodes — one
   oscillator per note, one gain per envelope — and rendered it offline. It was
   correct and it was unusable: sixty seconds took **twenty seconds** to render.

   The cost is quadratic, and measured: 10 s → 207 ms, 20 s → 797 ms. Four times
   the work for twice the audio. A Web Audio graph processes every *connected*
   node once per 128-sample quantum whether or not that node is sounding, and
   the number of nodes grows with the length of the piece — so total work is
   (nodes × quanta) = O(duration²). At ten seconds that is invisible; at sixty
   it is a stalled boot.

   So the score is summed sample by sample instead, in one pass per voice family.
   Work is linear in the number of samples, a wavetable lookup costs a handful
   of flops, and the whole side renders in well under a second.

   It is also the honest shape of the problem: this is a fixed, known score, not
   an interactive instrument. Nothing here needs a node graph.
   ======================================================================= */

export const SR = 44100;
export const FPS = 60;                     // analysis frames per second
const HOP = SR / FPS;                      // 735 samples, exactly

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------ wavetables */

const TBL = 4096;
const SIN = new Float32Array(TBL + 1);
const TRI = new Float32Array(TBL + 1);
const CLIP = new Float32Array(TBL + 1);
for (let i = 0; i <= TBL; i++) {
  const p = i / TBL;
  SIN[i] = Math.sin(2 * Math.PI * p);
  TRI[i] = 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5);
  // soft clip, covering ±2 so the lookup never has to hit its own edge
  const x = p * 4 - 2;
  CLIP[i] = Math.tanh(x * 1.7) / Math.tanh(1.7);
}

/* one xorshift for the whole render: the noise floor of a drum kit wants to be
   cheap, and reproducibility is worth more here than true randomness */
let rs = 0x2545f491;
function rnd() {
  rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
  return (rs >>> 0) / 2147483648 - 1;
}

/* ------------------------------------------------------------- the score */

/* Three arrangements, so the three tracks on a side do not sound like the same
   take three times. `hat` is a step in beats, `arp` 0 = off. */
const ARR = [
  { kick: [0, 2], snare: [], hat: 1, arp: 0, bass: [0, 2] },
  { kick: [0, 2], snare: [1, 3], hat: 0.5, arp: 0.5, bass: [0, 1, 2, 3] },
  { kick: [0, 1.5, 2, 3.5], snare: [1, 3], hat: 0.5, arp: 0.5, bass: [0, 1, 2, 3], fill: true },
];

/** 2-pole resonant bandpass (RBJ), for the snare's body */
function bpCoef(f, q, sr) {
  const w = (2 * Math.PI * f) / sr;
  const a = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + a;
  return [a / a0, 0, -a / a0, (-2 * c) / a0, (1 - a) / a0];
}

/* --------------------------------------------------------------- voices */

/** the pad: four notes, three detuned triangles each. Width comes from the beat
    between the copies, not from a chorus — and the envelope is built once
    because every chord has the same length. */
function addPad(bus, n0, env, midis) {
  const n = Math.min(env.length, bus.length - n0);
  const g = 0.042;
  for (const m of midis) {
    const base = hz(m);
    for (let d = -1; d <= 1; d++) {
      const inc = (base * (1 + d * 0.004)) / SR;      // ±7 cents
      let ph = 0.37 + d * 0.21;                       // decorrelated starts
      for (let i = 0; i < n; i++) {
        const x = ph * TBL, j = x | 0, fr = x - j;
        bus[n0 + i] += (TRI[j] + (TRI[j + 1] - TRI[j]) * fr) * env[i] * g;
        ph += inc; if (ph >= 1) ph -= 1;
      }
    }
  }
}

/** the bass: a saw through a filter whose cutoff opens on the attack and closes
    over the note — the same shape a plucked string's spectrum has */
function addBass(bus, n0, env, coef, midi, g) {
  const n = Math.min(env.length, bus.length - n0);
  const inc = hz(midi) / SR;
  let ph = 0.11, y = 0;
  for (let i = 0; i < n; i++) {
    const saw = ph * 2 - 1;
    y += coef[i] * (saw - y);
    bus[n0 + i] += y * env[i] * g;
    ph += inc; if (ph >= 1) ph -= 1;
  }
}

function addArp(bus, n0, dur, midi, g) {
  const n = Math.min(Math.round(dur * SR), bus.length - n0);
  const inc = hz(midi) / SR;
  const atk = Math.max(1, Math.round(0.009 * SR));
  let ph = 0.29;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = i < atk ? i / atk : Math.exp(-(t - atk / SR) / (dur * 0.3));
    const x = ph * TBL, j = x | 0, fr = x - j;
    bus[n0 + i] += (TRI[j] + (TRI[j + 1] - TRI[j]) * fr) * e * g;
    ph += inc; if (ph >= 1) ph -= 1;
  }
}

function addKick(bus, n0, g) {
  const n = Math.min(Math.round(0.34 * SR), bus.length - n0);
  const dk = 0.11 * SR;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = i < dk ? 118 * Math.pow(43 / 118, i / dk) : 43;
    let e = Math.exp(-t / 0.075);
    if (i < 70) e += (1 - i / 70) * 0.22 * rnd();      // beater click
    ph += f / SR; if (ph >= 1) ph -= 1;
    const x = ph * TBL, j = x | 0, fr = x - j;
    bus[n0 + i] += (SIN[j] + (SIN[j + 1] - SIN[j]) * fr) * e * g;
  }
}

function addSnare(bus, n0, g, bp) {
  const n = Math.min(Math.round(0.2 * SR), bus.length - n0);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let ph = 0.13;
  const inc = 184 / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = Math.exp(-t / 0.055);
    const x = rnd();
    const y = bp[0] * x + bp[1] * x1 + bp[2] * x2 - bp[3] * y1 - bp[4] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const bx = ph * TBL, bj = bx | 0, bf = bx - bj;
    const body = (SIN[bj] + (SIN[bj + 1] - SIN[bj]) * bf) * Math.exp(-t / 0.032) * 0.45;
    ph += inc; if (ph >= 1) ph -= 1;
    bus[n0 + i] += (y * 1.7 + body) * e * g;
  }
}

function addHat(bus, n0, g, open) {
  const d = open ? 0.2 : 0.042;
  const n = Math.min(Math.round(d * SR), bus.length - n0);
  const c = 1 - Math.exp((-2 * Math.PI * 7400) / SR);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(-(i / SR) / (d * 0.28));
    const x = rnd();
    y += c * (x - y);
    bus[n0 + i] += (x - y) * e * g;
  }
}

/* ------------------------------------------------------------- the render */

export async function renderSide(spec) {
  const dur = spec.dur;
  const N = Math.round(SR * dur);
  const bus = new Float32Array(N);
  const spb = 60 / spec.bpm;
  const bar = spb * 4;
  const bars = Math.floor(dur / bar);
  const chords = spec.chords;
  const roots = spec.roots;
  const arrIdx = spec.arr || [0, 1, 2];
  const tracks = spec.tracks;
  const kicks = [];
  const at = (t) => Math.round(t * SR);

  const trackAt = (t) => {
    for (let i = 0; i < tracks.length; i++) {
      if (t >= tracks[i].start && t < tracks[i].start + tracks[i].len) return i;
    }
    return 0;
  };

  /* ---- pad -------------------------------------------------------------
     Every chord lasts two bars, so one envelope serves all of them. Built once
     rather than per sample: this loop runs twelve times per chord and the pad
     is the one voice that is always sounding. */
  const padLen = bar * 2;
  const padN = Math.round(padLen * SR);
  const padEnv = new Float32Array(padN);
  {
    const atk = padLen * 0.34;
    const tail = padLen * 0.5;
    for (let i = 0; i < padN; i++) {
      const t = i / SR;
      padEnv[i] = t < atk ? t / atk : Math.max(0, 1 - (t - tail) / (padLen - tail));
    }
  }
  for (let k = 0; k * 2 * bar < dur; k++) {
    addPad(bus, at(k * 2 * bar), padEnv, chords[k % chords.length]);
  }

  /* ---- bass ------------------------------------------------------------
     One note length per side, so its envelope and cutoff sweep are built once
     too — about 70 notes share them. */
  const bassDur = spb * 0.92;
  const bassN = Math.round(bassDur * SR);
  const bassEnv = new Float32Array(bassN);
  const bassCoef = new Float32Array(bassN);
  {
    const atk = 0.014;
    const relAt = bassDur - 0.06;
    for (let i = 0; i < bassN; i++) {
      const t = i / SR;
      if (t < atk) bassEnv[i] = t / atk;
      else if (t > relAt) bassEnv[i] = Math.max(0, 1 - (t - relAt) / 0.25);
      else bassEnv[i] = 0.7 + 0.3 * Math.exp(-(t - atk) / 0.2);
    }
    for (let i = 0; i < bassN; i++) {
      const t = i / SR;
      const f = t < 0.07
        ? 110 + (560 - 110) * (t / 0.07)
        : 560 * Math.pow(170 / 560, (t - 0.07) / Math.max(0.01, bassDur - 0.07));
      bassCoef[i] = 1 - Math.exp((-2 * Math.PI * f) / SR);
    }
  }

  const bp = bpCoef(1750, 0.8, SR);

  /* ---- the bars --------------------------------------------------------- */
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const ci = Math.floor(b / 2) % chords.length;
    const A = ARR[arrIdx[Math.min(trackAt(t0), arrIdx.length - 1)] % ARR.length];
    const last = b % 4 === 3;

    for (const beat of A.bass) addBass(bus, at(t0 + beat * spb), bassEnv, bassCoef, roots[ci], 0.40);

    for (const beat of A.kick) {
      const n0 = at(t0 + beat * spb);
      addKick(bus, n0, 0.92);
      kicks.push(n0);
    }
    for (const beat of A.snare) addSnare(bus, at(t0 + beat * spb), 0.40, bp);

    for (let s = 0; s < 4 - 1e-9; s += A.hat) {
      const open = !!A.fill && last && s >= 3 - 1e-9;
      addHat(bus, at(t0 + s * spb), s % 1 === 0 ? 0.13 : 0.085, open);
    }

    if (A.arp) {
      const tones = chords[ci].map((m) => m + 12);
      let n = 0;
      for (let s = 0; s < 4 - 1e-9; s += A.arp) {
        addArp(bus, at(t0 + s * spb), spb * A.arp * 0.9, tones[n % tones.length], 0.08);
        n++;
      }
    }
  }

  /* ---- the bus ---------------------------------------------------------
     wobble → tone → saturation → sidechain → master, then out to two channels.
     The wobble is a delay line whose read pointer is nudged by a 0.6 Hz LFO:
     the tape's own pitch instability, which is what keeps the synthesis from
     reading as a sequencer. */
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  const dl = new Float32Array(N);
  const dSamp = Math.round(0.012 * SR);
  const lfoInc = 0.6 / SR;
  const lpC = 1 - Math.exp((-2 * Math.PI * 10000) / SR);
  const hpC = 1 - Math.exp((-2 * Math.PI * 1500) / SR);
  const duckCoef = 1 - Math.exp(-1 / (0.055 * SR));
  kicks.sort((a, b) => a - b);

  let lp = 0, hp = 0, duck = 1, ki = 0, lfoPh = 0;
  for (let i = 0; i < N; i++) {
    dl[i] = bus[i];

    lfoPh += lfoInc; if (lfoPh >= 1) lfoPh -= 1;
    const wx = lfoPh * TBL, wj = wx | 0, wf = wx - wj;
    const wob = SIN[wj] + (SIN[wj + 1] - SIN[wj]) * wf;

    const rd = i - dSamp - wob * 26;              // ±0.6 ms of wow
    let s = 0;
    if (rd >= 1) {
      const rj = rd | 0, rf = rd - rj;
      s = dl[rj] + (dl[rj + 1] - dl[rj]) * rf;
    } else if (rd >= 0) s = dl[0];

    lp += lpC * (s - lp);

    let cx = (lp + 2) / 4;
    cx = cx < 0 ? 0 : cx > 1 ? 1 : cx;
    const cxp = cx * TBL, cj = cxp | 0, cf = cxp - cj;
    let v = CLIP[cj] + (CLIP[cj + 1] - CLIP[cj]) * cf;

    if (ki < kicks.length && i >= kicks[ki]) { duck = 0.58; ki++; }
    duck += (1 - duck) * duckCoef;
    v *= duck * 0.84;

    hp += hpC * (v - hp);
    const side = (v - hp) * 0.16;                 // the top end is wider than the bottom
    outL[i] = v + side;
    outR[i] = v - side;
  }

  return { wav: encodeWav(outL, outR), analysis: analyse(outL, outR), dur };
}

/* ------------------------------------------------------------------- wav */

function writeStr(v, at, s) {
  for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
}

/** 16-bit PCM RIFF. Written through an Int16Array view rather than a DataView:
   two and a half million setInt16 calls is the difference between a fast boot
   and a slow one, and byte 44 is even, so the view is aligned. */
export function encodeWav(l, r) {
  const n = l.length;
  const ch = r ? 2 : 1;
  const bytes = 44 + n * ch * 2;
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  writeStr(dv, 0, 'RIFF'); dv.setUint32(4, bytes - 8, true); writeStr(dv, 8, 'WAVE');
  writeStr(dv, 12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * ch * 2, true);
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  writeStr(dv, 36, 'data'); dv.setUint32(40, n * ch * 2, true);

  const pcm = new Int16Array(ab, 44, n * ch);
  let o = 0;
  for (let i = 0; i < n; i++) {
    let a = l[i];
    a = a < -1 ? -1 : a > 1 ? 1 : a;
    pcm[o++] = a < 0 ? a * 0x8000 : a * 0x7fff;
    if (ch === 2) {
      let b = r[i];
      b = b < -1 ? -1 : b > 1 ? 1 : b;
      pcm[o++] = b < 0 ? b * 0x8000 : b * 0x7fff;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

/* -------------------------------------------------------------- analysis */

/* Four bands, one byte each per frame, 60 frames a second — the shape an
   AnalyserNode would have given, computed from samples we already hold. Three
   one-pole lowpasses split the spectrum; each band is normalised against its
   own peak, because a level meter reads movement, not absolute loudness. */
export function analyse(l, r) {
  const frames = Math.floor(l.length / HOP);
  const out = new Uint8Array(frames * 4);
  const a = [120, 500, 2000].map((f) => 1 - Math.exp((-2 * Math.PI * f) / SR));
  const raw = new Float32Array(frames * 4);
  const peak = [1e-6, 1e-6, 1e-6, 1e-6];
  let y1 = 0, y2 = 0, y3 = 0;

  for (let f = 0; f < frames; f++) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    const end = (f + 1) * HOP;
    for (let i = f * HOP; i < end; i++) {
      const x = r ? (l[i] + r[i]) * 0.5 : l[i];
      y1 += a[0] * (x - y1);
      y2 += a[1] * (x - y2);
      y3 += a[2] * (x - y3);
      const b0 = y1, b1 = y2 - y1, b2 = y3 - y2, b3 = x - y3;
      s0 += b0 * b0; s1 += b1 * b1; s2 += b2 * b2; s3 += b3 * b3;
    }
    const q = [Math.sqrt(s0 / HOP), Math.sqrt(s1 / HOP), Math.sqrt(s2 / HOP), Math.sqrt(s3 / HOP)];
    for (let k = 0; k < 4; k++) {
      raw[f * 4 + k] = q[k];
      if (q[k] > peak[k]) peak[k] = q[k];
    }
  }
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 4; k++) {
      const v = raw[f * 4 + k] / peak[k];
      out[f * 4 + k] = Math.round(Math.min(1, Math.pow(v, 0.6)) * 255);
    }
  }
  return out;
}
