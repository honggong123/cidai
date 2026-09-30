(async () => {
  const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => {
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(200); }
    return null;
  };

  // the loader is the page's own "everything is built" signal — the spirit is
  // created inside one of its steps, so anything asked before it clears is a
  // question about a page that does not exist yet
  const loaderGone = !!(await until(() => {
    const l = document.querySelector('#loader');
    return !l || getComputedStyle(l).opacity === '0';
  }, 180000));

  const cv = document.querySelector('canvas');
  const gl = cv && (cv.getContext('webgl2') || cv.getContext('webgl'));
  const lose = gl && gl.getExtension('WEBGL_lose_context');

  const txt = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };

  return JSON.stringify({
    loaderGone,
    waitedSec: +((Date.now() - t0) / 1000).toFixed(1),
    canvas: cv ? { w: cv.width, h: cv.height } : null,
    glLost: gl ? gl.isContextLost() : 'no context',
    hasLoseExt: !!lose,
    // inline-ness of the deliverable: everything the page needs must be inside
    // this one file, so any src/href pointing at a sibling is a broken promise
    externalRefs: [...document.querySelectorAll('script[src],link[href],img[src]')]
      .map((e) => e.getAttribute('src') || e.getAttribute('href'))
      .filter((u) => u && !/^(data:|blob:|#)/.test(u)),
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    inlineStyles: document.querySelectorAll('style').length,
    title: document.title,
    brand: txt('.brand h1'),
    code: txt('#brand-code'),
    playLabel: txt('#play-label'),
    hud: txt('.hud-l'),
    themes: [...document.querySelectorAll('[data-theme]')].map((b) => b.dataset.theme),
    bodyClasses: [...document.body.classList],
    // the tape's own markup must be gone, not merely hidden — a leftover node
    // would still be focusable and still be read out
    tapeNodesLeft: document.querySelectorAll('#btn-explode,#btn-flip,[data-act="explode"],[data-act="flip"]').length,
    spiritImgDecoded: await (async () => {
      const im = new Image();
      im.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      try { await im.decode(); return true; } catch { return false; }
    })(),
  });
})()
