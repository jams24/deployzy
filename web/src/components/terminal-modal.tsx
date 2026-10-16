"use client";

// Interactive web shell into a running project container. Opens a WebSocket to
// /api/v1/ws/projects/{id}/terminal, wires it to an xterm.js terminal, and
// streams keystrokes ↔ container both ways. xterm is imported dynamically so it
// never runs during SSR (it touches `window` at module load).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, TerminalSquare, RotateCw } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export function TerminalModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  const initedRef = useRef(false); // guard: only ever build one terminal per mount
  const [status, setStatus] = useState<"connecting" | "connected" | "closed">("connecting");
  const [nonce, setNonce] = useState(0); // bump to reconnect
  const [mounted, setMounted] = useState(false); // for portal (client only)

  useEffect(() => setMounted(true), []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Wait until the portal DOM is committed (mounted === true) so hostRef is
    // actually attached. Without this, a *cached* xterm dynamic-import resolves
    // before the portal renders, hostRef.current is null, and the effect bails
    // silently → stuck on "connecting" (only on the 2nd+ open, when the import
    // is warm). Gating on `mounted` guarantees the host div exists first.
    if (!mounted) return;
    // StrictMode / re-render guard: if we've already built a terminal for this
    // mount, don't build a second one (that caused doubled echo + phantom WS).
    if (initedRef.current) return;
    initedRef.current = true;

    let disposed = false;
    let ro: ResizeObserver | null = null;
    let keepAlive: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: {
          background: "#0d1117",
          foreground: "#c9d1d9",
          cursor: "#3fb950",
          cursorAccent: "#0d1117",
          selectionBackground: "#264f78",
          black: "#484f58",
          red: "#ff7b72",
          green: "#3fb950",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#39c5cf",
          white: "#b1bac4",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      const dec = new TextDecoder();
      const token = localStorage.getItem("sm_token") || "";

      // Preflight: verify the token is still valid before opening a WebSocket.
      // An expired token makes the WS upgrade 401 silently, and Safari leaves it
      // stuck on "connecting" forever. A cheap REST check gives a clear answer.
      try {
        const me = await fetch(`${API}/api/v1/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (disposed) return;
        if (me.status === 401 || me.status === 403) {
          setStatus("closed");
          term.write(
            "\r\n\x1b[31mYour session has expired.\x1b[0m\r\n" +
              "\x1b[90mPlease sign out and sign back in, then reopen the terminal.\x1b[0m\r\n"
          );
          return;
        }
      } catch {
        // Network hiccup — fall through and let the WS attempt surface it.
      }

      const base = API.replace(/^http/, "ws");
      const ws = new WebSocket(
        `${base}/api/v1/ws/projects/${projectId}/terminal?token=${encodeURIComponent(token)}`
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      const sendResize = () => {
        if (!fitRef.current || !termRef.current) return;
        try {
          fitRef.current.fit();
        } catch {
          /* ignore */
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };

      let gotFirstByte = false;
      let opened = false;

      // Watchdog: if the socket never even reaches OPEN, the request isn't
      // leaving the browser (stale bundle / blocked / expired token). Surface
      // that instead of an eternal "connecting" spinner.
      const watchdog = setTimeout(() => {
        if (!opened && !disposed) {
          term.write(
            "\r\n\x1b[33mStill trying to reach the server…\x1b[0m\r\n" +
              "\x1b[90mIf this doesn't connect: hard-refresh the page (Cmd+Shift+R),\r\n" +
              "and if it persists, sign out and back in (session may have expired).\x1b[0m\r\n"
          );
        }
      }, 8000);

      ws.onopen = () => {
        opened = true;
        // Socket is up, but for remote-worker projects the shell itself is
        // still spinning up an SSH session — keep "connecting" until the first
        // byte of real output lands so the badge reflects shell readiness.
        term.write("\x1b[90mEstablishing session…\x1b[0m");
        setTimeout(sendResize, 60);
        term.focus();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const m = JSON.parse(ev.data);
            if (m.type === "error") term.write(`\r\n\x1b[31m${m.msg}\x1b[0m\r\n`);
          } catch {
            /* ignore */
          }
          return;
        }
        if (!gotFirstByte) {
          gotFirstByte = true;
          clearTimeout(watchdog);
          setStatus("connected");
          // Clear the "Establishing session…" placeholder line.
          term.write("\r\x1b[2K");
        }
        term.write(dec.decode(new Uint8Array(ev.data as ArrayBuffer)));
      };
      ws.onclose = () => {
        clearTimeout(watchdog);
        if (keepAlive) clearInterval(keepAlive);
        if (!disposed) setStatus("closed");
        term.write("\r\n\x1b[90m— session closed —\x1b[0m\r\n");
      };
      ws.onerror = () => {
        if (!disposed) setStatus("closed");
      };

      // keystrokes → container
      term.onData((d: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data: d }));
        }
      });

      // Keepalive: Cloudflare closes idle WebSockets after ~100s of no traffic,
      // which silently freezes the shell (keystrokes go nowhere). Send a no-op
      // the server ignores every 30s so the connection never idles out. If the
      // socket has already died, flip to "closed" so the Reconnect button shows.
      keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        } else if (ws.readyState === WebSocket.CLOSED && !disposed) {
          setStatus("closed");
        }
      }, 30000);

      // Re-fit whenever the modal box changes size.
      ro = new ResizeObserver(() => sendResize());
      if (hostRef.current) ro.observe(hostRef.current);
    })();

    return () => {
      disposed = true;
      if (keepAlive) clearInterval(keepAlive);
      try {
        ro?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      try {
        termRef.current?.dispose();
      } catch {
        /* ignore */
      }
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
      initedRef.current = false;
    };
  }, [projectId, nonce, mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117] shadow-2xl"
        style={{ height: "min(82vh, 720px)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* title bar with mac-style dots */}
        <div className="flex items-center justify-between border-b border-[#30363d] bg-[#161b22] px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
              <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
              <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
            </div>
            <div className="flex items-center gap-2 min-w-0 text-sm">
              <TerminalSquare className="h-4 w-4 shrink-0 text-[#3fb950]" />
              <span className="font-medium text-[#c9d1d9]">Terminal</span>
              <span className="truncate text-[#8b949e]">— {projectName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="flex items-center gap-1.5 text-xs text-[#8b949e]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "connected"
                    ? "bg-[#3fb950] animate-pulse"
                    : status === "connecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-[#6e7681]"
                }`}
              />
              {status}
            </span>
            {status === "closed" && (
              <button
                onClick={() => {
                  setStatus("connecting");
                  setNonce((n) => n + 1);
                }}
                className="flex items-center gap-1 rounded-md border border-[#30363d] px-2 py-1 text-xs text-[#c9d1d9] hover:bg-[#21262d]"
                title="Reconnect"
              >
                <RotateCw className="h-3 w-3" /> Reconnect
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* terminal surface */}
        <div className="min-h-0 flex-1 bg-[#0d1117] px-3 py-2">
          <div ref={hostRef} className="h-full w-full" />
        </div>
      </div>
    </div>,
    document.body
  );
}
