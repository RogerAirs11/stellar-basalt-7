# Happ / Per-App Proxy local-development compatibility

The dev server intentionally binds to `0.0.0.0:5173` instead of loopback-only `127.0.0.1`.
This allows the browser to reach the Vite server through another local interface when `node.exe` is routed through Happ or a similar per-app proxy.

The Smart Launcher v4 probes browser-side URLs after the server starts. It tries:

1. `http://127.0.0.1:5173`
2. `http://localhost:5173`
3. each active non-loopback IPv4 address on port `5173`

The first URL that answers HTTP is opened automatically. This avoids assuming that loopback is visible when a per-app tunnel is active.

If Happ still blocks all local listeners, excluding `node.exe` from its per-app proxy remains the most reliable fallback.
