/* ============================== the demo programme =====================

   Two sides of sixty seconds, six tracks, all of it synthesised at runtime.
   The programme it replaces was a commercial record that cannot ship with the
   repository, so rather than leave the deck empty the page carries its own
   pressing — a fictional release by a fictional band, which is also the honest
   thing to put on a label in a page that is about the room rather than the
   music.

   A side is one continuous piece of audio; the three tracks are regions of it.
   That is how a real tape works, and it means the seek rail, the counter and
   the label bake all keep speaking the language they already spoke: a track is
   `applyTrack()` plus a position.

   The two sides are deliberately different keys and tempos, so switching sides
   is audible as well as visible. They are reached from the track list, which
   lists both — the 翻面 button that used to reach B is gone with the shell (see
   TAPE_ON in main.js), and this list is where B was always reachable anyway.
   ======================================================================= */

import { renderSide } from './demo-audio.js';

const ARTIST = '烛芯';      // 唱这些歌的「人」：一支只在城堡里演出的幽魂合唱团

const A_TRACKS = [
  { no: 'A1', title: '静水', start: 0, len: 20 },
  { no: 'A2', title: '慢速带', start: 20, len: 20 },
  { no: 'A3', title: '零点漂移', start: 40, len: 20 },
];
const B_TRACKS = [
  { no: 'B1', title: '长回声', start: 0, len: 20 },
  { no: 'B2', title: '退磁', start: 20, len: 20 },
  { no: 'B3', title: '底噪', start: 40, len: 20 },
];

/* A side: A natural minor, 92 BPM — Am7 · Fmaj7 · Cadd9 · G6, two bars each.
   B side: D dorian, 76 BPM — Dm7 · G9 · Bbmaj7 · Cadd9, slower and lower. */
export const SIDES = [
  {
    id: 'A',
    cn: '夜歌 · 一',
    /* what gets printed on the label for this side */
    label: { title: '炉边谣', artist: ARTIST, album: '小幽灵演示曲 · 夜歌 · 一' },
    spec: {
      dur: 60, bpm: 92, arr: [0, 1, 2], tracks: A_TRACKS,
      chords: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 62], [55, 59, 62, 66]],
      roots: [33, 29, 36, 31],
    },
  },
  {
    id: 'B',
    cn: '夜歌 · 二',
    label: { title: '沉雾', artist: ARTIST, album: '小幽灵演示曲 · 夜歌 · 二' },
    spec: {
      dur: 60, bpm: 76, arr: [1, 2, 0], tracks: B_TRACKS,
      chords: [[50, 53, 57, 60], [47, 50, 53, 57], [46, 50, 53, 57], [48, 52, 55, 62]],
      roots: [38, 43, 46, 48],
    },
  },
];

for (const s of SIDES) {
  s.tracks = s.spec.tracks;
  s.dur = s.spec.dur;
  s.url = null;              // filled by loadSide()
  s.analysis = null;         // ...and with it, the four-band envelope
}

/* Rendering a side is the one expensive thing this page does off the GPU:
   sixty seconds of stereo at 44.1 kHz, a couple of thousand scheduled voices.
   It is therefore lazy — side A on boot, side B the first time it is asked
   for — and memoised, because a blob URL is worth keeping: the object URL
   whitelist in main.js exists precisely so nothing revokes these. */
export async function loadSide(i) {
  const s = SIDES[i];
  if (!s) return null;
  if (s.url) return s;
  const { wav, analysis } = await renderSide(s.spec);
  s.url = URL.createObjectURL(wav);
  s.analysis = analysis;
  return s;
}

/** which side a blob URL belongs to — the URL is the only handle the audio
    element keeps on the tape it is holding */
export function sideOf(url) {
  return SIDES.find((s) => s.url && s.url === url) || null;
}

/** the track a position inside a side falls on */
export function trackAt(side, t) {
  if (!side) return null;
  for (const k of side.tracks) if (t >= k.start && t < k.start + k.len) return k;
  return side.tracks[side.tracks.length - 1] || null;
}
