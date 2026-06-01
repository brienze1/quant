/*
 * quant remote bridge
 * Fakes the Wails window.go / window.runtime objects so the React app runs
 * unmodified in a plain browser. Method calls go over HTTP (/__quant_remote/rpc);
 * backend events arrive over a WebSocket (/__quant_remote/ws). Loaded only when
 * quant serves the UI in remote mode — never in the desktop webview.
 */
(function () {
  "use strict";

  // Marker so the app knows it's running remotely (in a browser, not the Wails
  // desktop webview) — used to hide desktop-only controls like the remote-access
  // settings tab, whose controller is intentionally not exposed over the tunnel.
  window.__quantRemote = true;

  var RPC = "/__quant_remote/rpc";
  var WS =
    (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host +
    "/__quant_remote/ws";

  // --- method calls: window.go.<pkg>.<struct>.<method>(...args) -> POST /rpc ---
  function call(struct, method, args) {
    return fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ struct: struct, method: method, args: args }),
    })
      .then(function (res) {
        if (res.status === 401) {
          location.reload(); // session expired -> back to login
          return new Promise(function () {});
        }
        return res.json();
      })
      .then(function (payload) {
        if (payload && payload.error) {
          return Promise.reject(new Error(payload.error));
        }
        return payload ? payload.result : undefined;
      });
  }

  function ignore(prop) {
    return typeof prop === "symbol" || prop === "then";
  }

  function methodProxy(struct, method) {
    return function () {
      return call(struct, method, Array.prototype.slice.call(arguments));
    };
  }
  function structProxy(struct) {
    return new Proxy(
      {},
      {
        get: function (_t, method) {
          if (ignore(method)) return undefined;
          return methodProxy(struct, String(method));
        },
      }
    );
  }
  var pkgProxy = new Proxy(
    {},
    {
      get: function (_t, struct) {
        if (ignore(struct)) return undefined;
        return structProxy(String(struct));
      },
    }
  );
  // Any package name (e.g. "controller") resolves to the same struct proxy.
  window.go = new Proxy(
    {},
    {
      get: function (_t, pkg) {
        if (ignore(pkg)) return undefined;
        return pkgProxy;
      },
    }
  );

  // --- events: a single shared WebSocket fans out to EventsOn listeners ---
  var listeners = {}; // event name -> [callbacks]
  var ws = null;

  function connect() {
    ws = new WebSocket(WS);
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      var cbs = listeners[msg.event];
      if (cbs) {
        cbs.slice().forEach(function (cb) {
          try {
            cb(msg.data);
          } catch (e) {}
        });
      }
    };
    ws.onclose = function () {
      setTimeout(connect, 1500); // auto-reconnect
    };
    ws.onerror = function () {
      try {
        ws.close();
      } catch (e) {}
    };
  }
  connect();

  window.runtime = window.runtime || {};
  window.runtime.EventsOn = function (name, cb) {
    (listeners[name] = listeners[name] || []).push(cb);
    return function () {
      var arr = listeners[name];
      if (!arr) return;
      var i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  };
  window.runtime.EventsOff = function (name) {
    delete listeners[name];
  };
  // Best-effort no-op for any other runtime call the app may make.
  window.runtime.EventsEmit = function () {};
})();
