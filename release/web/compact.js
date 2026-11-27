// Homepage add-ons (no network use): map-of-meaning button + overlay, and the statement's search bar runs a real search.
(function () {
  function openMap() { if (!document.querySelector('.mm-modal')) { var x = document.querySelector('.mm-expand'); if (x) x.click(); } }
  function setup() {
    var intro = document.querySelector('.mm-wrap .mm-intro');
    if (intro && !intro.querySelector('.mm-open-btn')) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'mm-open-btn';
      b.innerHTML = 'Explore the map <span aria-hidden="true">⤢</span>';
      b.addEventListener('click', openMap);
      intro.appendChild(b);
    }
    // A round badge set into the heading, like the badges in the statement above.
    var h = document.querySelector('.mm-wrap .mm-intro h2');
    if (h && !h.querySelector('.mm-badge') && h.firstChild && h.firstChild.nodeType === 3) {
      var i = h.firstChild.data.indexOf('map ');
      if (i >= 0) {
        var rest = h.firstChild.splitText(i + 4);
        var s = document.createElement('span'); s.className = 'mm-badge'; s.setAttribute('aria-hidden', 'true');
        s.innerHTML = '<svg viewBox="0 0 24 24"><line x1="6" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="18" y2="7"/><line x1="12" y1="12" x2="15" y2="18"/><circle cx="6" cy="8" r="2.2"/><circle cx="18" cy="7" r="1.8" class="f"/><circle cx="15" cy="18" r="2"/><circle cx="12" cy="12" r="3"/><circle cx="7" cy="17" r="1.4" class="f"/></svg>';
        h.insertBefore(s, rest);
      }
    }
  }
  new MutationObserver(setup).observe(document.documentElement, { childList: true, subtree: true });
  setup();
  // Placing a question or tapping an example opens the floating map to show where it landed.
  document.addEventListener('submit', function (e) { if (e.target.closest && e.target.closest('.mm-wrap .mm-ask')) setTimeout(openMap, 700); }, true);
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.mm-wrap .mm-intro .mm-chips button')) setTimeout(openMap, 700); }, true);
  // The "Describe what you need…" bar under the statement: run the same on-device search as the main box.
  document.addEventListener('submit', function (e) {
    var form = e.target.closest && e.target.closest('form.ask-bar'); if (!form) return;
    e.preventDefault(); e.stopPropagation();
    var src = form.querySelector('input'); var q = (src && src.value || '').trim(); if (!q) return;
    var main = document.getElementById('question'); if (!main) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(main, q);
    main.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(src, '');
    src.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(function () { var s = document.querySelector('.send-button'); if (s) s.click(); }, 60);
  }, true);
})();
