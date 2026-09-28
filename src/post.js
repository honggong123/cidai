import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AOPass } from './ao.js';

const Grade = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.05 },
    uVig: { value: 0.85 },
    uCA: { value: 0.85 },
    uFade: { value: 0 },
    uSat: { value: 1.0 },
    uHal: { value: 0.06 },
    /* The bleed off the brightest speculars is warm in two of the three rooms and
       cold in the third, and that is not a detail — a warm halo on a blue
       highlight is the single fastest way to make a "cold" scene look like a
       filter. It is a uniform rather than a constant for exactly that reason. */
    uHalTint: { value: new THREE.Vector3(1.0, 0.60, 0.32) },
    uEdge: { value: 1.0 },     // lens defocus strength away from the subject
    uFocus: { value: 0.26 },   // uv radius that stays sharp
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVig, uCA, uFade, uSat, uHal, uEdge, uFocus;
    uniform vec2 uCenter, uTexel;
    uniform vec3 uHalTint;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p + 19.19); return fract(p.x * p.y); }

    // 9 tap disc — at r = 0 this collapses back to a single fetch
    vec3 disc(vec2 uv, vec2 r) {
      vec3 s = texture2D(tDiffuse, uv).rgb * 0.22;
      s += texture2D(tDiffuse, uv + vec2(r.x, 0.0)).rgb * 0.10;
      s += texture2D(tDiffuse, uv - vec2(r.x, 0.0)).rgb * 0.10;
      s += texture2D(tDiffuse, uv + vec2(0.0, r.y)).rgb * 0.10;
      s += texture2D(tDiffuse, uv - vec2(0.0, r.y)).rgb * 0.10;
      s += texture2D(tDiffuse, uv + r * 0.70).rgb * 0.095;
      s += texture2D(tDiffuse, uv - r * 0.70).rgb * 0.095;
      s += texture2D(tDiffuse, uv + vec2(r.x, -r.y) * 0.70).rgb * 0.095;
      s += texture2D(tDiffuse, uv + vec2(-r.x, r.y) * 0.70).rgb * 0.095;
      return s;
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // soft wide-open falloff outside the focus radius
      float def = smoothstep(uFocus, uFocus + 0.40, distance(uv, uCenter)) * uEdge;
      vec2 blur = uTexel * (1.0 + def * 4.6);

      vec2 off = d * r2 * uCA * 0.012;
      vec3 c;
      c.r = disc(uv + off, blur).r;
      c.g = disc(uv, blur).g;
      c.b = disc(uv - off, blur).b;

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

      // filmic split tone — cool shadows, warm highlights
      c *= mix(vec3(0.93, 0.985, 1.07), vec3(1.055, 1.005, 0.935), smoothstep(0.16, 0.86, l));
      // halation: bleed off the brightest speculars, in whatever colour the
      // room says a highlight bleeds
      c += uHalTint * smoothstep(0.78, 1.0, l) * uHal;
      c = mix(vec3(l), c, uSat);

      float vig = smoothstep(1.18, 0.28, length(d) * 1.42);
      c *= mix(1.0, vig, uVig);

      float g = hash(uv * vec2(1927.0, 1087.0) + fract(uTime) * 91.7);
      c += (g - 0.5) * uGrain * mix(1.35, 0.35, smoothstep(0.0, 0.8, l));

      gl_FragColor = vec4(c * uFade, 1.0);
    }
  `,
};

/* ============================== glare ==================================

   The one thing a bloom cannot do: a bloom is round, and a lens is not. This is
   the anamorphic streak a wide aperture drags out of a bright source — the light
   pulled sideways into a bar and tinted by whatever the coating does to it. The
   two are not the same effect at different sizes, so this is a pass rather than
   another bloom setting.

   It runs on the HDR buffer, between the bloom and the tone map, so the streak is
   built out of the same over-1.0 values the bloom is built from. That ordering is
   the whole trick: a highlight has to be genuinely brighter than white to leave a
   trail, and nothing that is merely white will.

   Six taps a side, weights falling as 1/i. That is not the point-spread function
   of any real lens — it is the cheapest shape that reads as one, and at the
   strengths this page uses, the difference between it and a 32-tap integral is
   not something the eye can find.

   `uStrength` at 0 contributes exactly nothing, but the taps still cost — which
   is why the pass is switched off outright rather than set to zero (see
   glareOn() in main.js).
   ====================================================================== */
const Glare = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Vector3(0.55, 0.78, 1.0) },
    uStrength: { value: 0 },
    uStride: { value: 0.011 },
    uThreshold: { value: 0.62 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform float uStrength, uStride, uThreshold;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 g = vec3(0.0);
      float wsum = 0.0;
      for (int i = 1; i <= 6; i++) {
        float o = float(i) * uStride;
        float w = 1.0 / float(i);
        g += texture2D(tDiffuse, vUv + vec2(o, 0.0)).rgb * w;
        g += texture2D(tDiffuse, vUv - vec2(o, 0.0)).rgb * w;
        wsum += 2.0 * w;
      }
      g /= wsum;
      // only what is over the threshold contributes, and softly — a highlight
      // crosses into leaving a trail rather than switching one on
      vec3 lit = max(g - uThreshold, 0.0);
      base.rgb += lit * uTint * uStrength;
      gl_FragColor = base;
    }
  `,
};

export function createComposer(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // a real depth texture on the beauty target: three resolves it for free as
  // part of the MSAA blit, so the AO pass needs no prepass of its own
  const depthTexture = new THREE.DepthTexture(size.x, size.y);
  depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
  depthTexture.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    samples: 4,
    depthBuffer: true,
    depthTexture,
    resolveDepthBuffer: true,
  });
  const composer = new EffectComposer(renderer, rt);
  /* RenderPass always draws into readBuffer, and readBuffer alternates between
     the composer's two targets: the chain swaps an odd number of times per
     frame (AO, Output, Grade). rt's clone carries a *cloned* depth texture —
     three clones the depth attachment along with the target — so the AO would be
     handed the previous frame's depth on every other frame.
     The subject drifts ~0.08 px per frame, so that shows up as an occlusion
     pattern that flips between two slightly different images at half the frame
     rate: a shimmer on every edge, which no amount of sampling tweaking fixes.
     Point both buffers at one depth texture and the resolved depth is always
     the frame being shaded. */
  composer.renderTarget2.depthTexture = depthTexture;
  const render = new RenderPass(scene, camera);
  const ao = new AOPass(camera, size.x, size.y);
  ao.setDepthTexture(depthTexture);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.70, 0.87);
  const glare = new ShaderPass(Glare);
  const output = new OutputPass();
  const grade = new ShaderPass(Grade);
  grade.uniforms.uFade.value = 0;
  composer.addPass(render);
  composer.addPass(ao);
  composer.addPass(bloom);
  composer.addPass(glare);
  composer.addPass(output);
  composer.addPass(grade);
  return { composer, render, ao, bloom, glare, grade, output, depthTexture };
}
