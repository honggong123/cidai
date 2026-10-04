/* Pick the CDP page target that belongs to *our* dev server.

   `/json/list` returns every page target in the browser, and the obvious
   `list.find(t => t.type === 'page')` takes whichever one happens to be first.
   On a machine that is also serving some *other* project through the same
   Chrome — which is the normal state of this one — that is that other project.
   The failure is nasty because what comes back is a perfectly well-formed
   reading of the wrong page: screenshots render fine and show a different
   character, measurements are self-consistent and describe a different layout.
   It cost an afternoon here, and the first two diagnoses blamed the model.

   So match on the host of the URL the caller already has. Fall back to "the
   only page there is" when there is exactly one, and otherwise refuse loudly
   and say what *is* open, because a wrong answer is worse than no answer. */
export function pickPage(list, url) {
  const pages = list.filter((t) => t.type === 'page');
  const host = (u) => { try { return new URL(u).host; } catch { return null; } };
  const want = host(url);
  if (want) {
    const hit = pages.find((t) => host(t.url) === want);
    if (hit) return hit;
  }
  if (pages.length === 1) return pages[0];
  throw new Error(
    `no CDP page target for ${want || url} — open that URL in this browser first.` +
    '\n  page targets present:' +
    (pages.length ? pages.map((t) => '\n    ' + t.url).join('') : '\n    (none)'),
  );
}
