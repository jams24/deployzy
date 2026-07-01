/* Deployzy Analytics — cookieless pageview + custom event tracking.
 *
 * Auto-tracks:
 *   • initial pageview on load
 *   • SPA route changes via history.pushState / popstate
 *
 * Manual tracking:
 *   window.sm.track("signup", { plan: "pro" })
 *
 * The script tag's data-sm-endpoint attribute (optional) overrides the
 * ingest URL; by default we POST to the same origin's /__sm-ingest path
 * which the Deployzy proxy routes back to the analytics backend.
 */
(function () {
  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName("script");
    return all[all.length - 1];
  })();
  var endpoint = (script && script.getAttribute("data-sm-endpoint")) || "/__sm-ingest";
  var lastPath = "";

  function send(type, name, props) {
    try {
      var payload = {
        type: type,                                    // "pageview" | "event"
        name: name || "",
        path: location.pathname + location.search,
        referrer: document.referrer || "",
        screen: window.screen ? (window.screen.width + "x" + window.screen.height) : "",
        lang: navigator.language || "",
        props: props || {},
      };
      var body = JSON.stringify(payload);
      // sendBeacon works during page unload and doesn't block navigation.
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(endpoint, blob)) return;
      }
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
        credentials: "omit",
      }).catch(function () {});
    } catch (_) {}
  }

  function pageview() {
    var path = location.pathname + location.search;
    if (path === lastPath) return;
    lastPath = path;
    send("pageview");
  }

  // Initial pageview.
  pageview();

  // SPA navigation: wrap pushState/replaceState so framework routers fire
  // our tracker. Also listen for popstate (back/forward).
  ["pushState", "replaceState"].forEach(function (k) {
    var orig = history[k];
    history[k] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(pageview, 0);
      return r;
    };
  });
  window.addEventListener("popstate", pageview);
  window.addEventListener("hashchange", pageview);

  // Public API.
  window.sm = {
    track: function (name, props) { send("event", String(name || ""), props); },
    pageview: pageview,
  };
})();
