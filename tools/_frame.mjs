/* Does `computeFrenetFrames` put the lock's `deep` axis where the code thinks?
   `lock` says: `deep` scales the frame's NORMAL axis and `flat` the BINORMAL one,
   and for a lock running down the front of the skull the normal "points straight
   out of the head". That is a claim about three.js's Frenet frame, which picks
   its own roll about the tangent. This prints the angle between each ring's
   normal and the true radial direction, for the real fringe curves. */
import * as THREE from 'three';

const HAIR_R = 1.01;
const DEEP = 0.62;
function hp(yaw, lat, r = HAIR_R) {
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(lat) * r, Math.sin(lat) * r, Math.cos(yaw) * Math.cos(lat) * r);
}

const FRINGE = [
  [-0.52, -0.82, 0.74, -0.58, 0.165],
  [-0.26, -0.44, 0.78, -0.34, 0.175],
  [ 0.00,  0.03, 0.82, -0.52, 0.182],
  [ 0.26,  0.45, 0.78, -0.34, 0.175],
  [ 0.52,  0.83, 0.74, -0.58, 0.165],
];

const segs = 30;
for (const [yawR, yawT, latR, latT, rad] of FRINGE) {
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    const yaw = yawR + (yawT - yawR) * Math.pow(u, 1.4);
    const lat = latR + (latT - latR) * Math.pow(u, 0.80);
    pts.push(hp(yaw, lat, HAIR_R + rad * DEEP * (0.40 + 0.25 * u)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const fr = curve.computeFrenetFrames(segs, false);
  const deg = [];
  for (const i of [0, Math.round(segs / 3), Math.round(2 * segs / 3), segs]) {
    const p = curve.getPoint(i / segs);
    const radial = p.clone().normalize();                 // outward from the skull
    const n = fr.normals[i];
    const b = fr.binormals[i];
    deg.push(
      `t=${(i / segs).toFixed(2)}  n·radial=${n.dot(radial).toFixed(3)} (${(Math.acos(Math.min(1, Math.abs(n.dot(radial)))) * 180 / Math.PI).toFixed(0)}° off)  b·radial=${b.dot(radial).toFixed(3)}`);
  }
  console.log(`fringe root yaw ${yawR}`);
  for (const d of deg) console.log('   ', d);
}
