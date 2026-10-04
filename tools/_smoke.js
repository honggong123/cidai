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

  /* 标签页标题是一条**走带读数**，它只在主循环的计数器块里被写 —— 那个块每
     0.2 **页面秒**才走一次。`dt` 截到 1/20、软件渲染一帧 ≈ 1s 墙钟，所以第一次
     写入落在 `loop()` 启动后约 4s，也就是 loader 消失之后。在 loader 刚消失的
     那一刻读它，拿到的是 index.html 的静态 `<title>`，看上去完全像"页面从来没
     改过标题"。上一轮就是拿这个字段下过"开发页与产物 title 不一致"的结论。
     `until` 的预算从 `t0` 起算（不是每次调用重新计时），所以这里必须把启动的
     那 20s 一起留出来。 */
  const titleAtStart = document.title;
  await until(() => document.title !== titleAtStart, 90000);

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
    // the plate: one introduction, and a list of things to ask her to do. Read
    // as text rather than as counts, because the interesting failure is not a
    // missing row — it is a row that survived the rewrite with the old wording
    plate: {
      crumb: txt('.crumb-id'),
      cn: txt('#file-cn'),
      en: txt('#file-en'),
      specRows: document.querySelectorAll('#file-spec li').length,
      refHead: txt('.ref-h'),
      moves: [...document.querySelectorAll('#ref-list .row')].map((r) => r.textContent.trim()),
      tip: txt('.ref-tip'),
      selNum: `${txt('#sel-i')}/${txt('#sel-n')}`,
      deckMicro: txt('.sel .micro'),
      ticks: document.querySelectorAll('#cols .tick').length,
    },
    // the tape's own markup must be gone, not merely hidden — a leftover node
    // would still be focusable and still be read out
    tapeNodesLeft: document.querySelectorAll('#btn-explode,#btn-flip,[data-act="explode"],[data-act="flip"]').length,
    // ...and so must the 2D sprite. This used to decode a 1x1 GIF, which proved
    // nothing about the page and even less after the sprite was replaced by a
    // model. What is worth asserting now is that the model is *there* and
    // answering: `__spirit` is a read-only hook (see main.js) and `bob` is a
    // number only once `update` has run at least one frame.
    spiritHook: (() => {
      const s = window.__spirit;
      if (!s) return 'missing';
      return typeof s.bob === 'number' && typeof s.aimX === 'number' ? 'live' : 'inert';
    })(),
    // no <img> and no <canvas> that is not the renderer: the deliverable draws
    // her out of primitives, so a decoded bitmap would be a leftover asset
    bitmapNodes: document.querySelectorAll('img, canvas:not(#gl)').length,
  });
})()
