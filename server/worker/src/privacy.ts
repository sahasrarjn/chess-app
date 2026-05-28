export const privacyHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — Border Chess</title>
<meta name="description" content="Privacy policy for Border Chess iPhone app and web game.">
<link rel="icon" href="/logo.png" type="image/png">
<style>
  :root {
    color-scheme: dark;
    --bg: #0c1117;
    --text: #f4f4f5;
    --muted: #a1a1aa;
    --accent: #10b981;
    --border: rgba(255,255,255,.08);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 24px 64px; }
  a { color: var(--accent); }
  h1 { font-size: 1.75rem; margin-bottom: 8px; }
  .meta { color: var(--muted); margin-bottom: 28px; font-size: 14px; }
  h2 { font-size: 1.1rem; margin: 28px 0 10px; }
  p, li { color: #d4d4d8; margin-bottom: 10px; }
  ul { padding-left: 1.25rem; margin-bottom: 12px; }
  nav { margin-bottom: 24px; font-size: 14px; }
  hr { border: none; border-top: 1px solid var(--border); margin: 32px 0; }
</style>
</head>
<body>
<div class="wrap">
  <nav><a href="/">← Border Chess</a></nav>
  <h1>Privacy Policy</h1>
  <p class="meta">Last updated: May 28, 2026 · <a href="https://github.com/sahasrarjn/chess-app/issues">Contact</a></p>

  <p>Border Chess is published by Sahasra Ranjan. This policy covers the iPhone app, browser game, and related services.</p>

  <h2>Summary</h2>
  <ul>
    <li>No account, login, or ads.</li>
    <li><strong>Play with Friend</strong> is offline on your device.</li>
    <li><strong>Play vs Bot</strong> sends chess positions to our server over HTTPS.</li>
    <li>We do not sell your data.</li>
  </ul>

  <h2>Information the app sends</h2>
  <p>When you use <strong>Play vs Bot</strong>, the app sends the current board position (FEN) and move settings to <code>chess-engine.sahasraranjan.workers.dev</code> so the engine can reply. Our edge service may also see your IP address for rate limiting and abuse prevention—not for advertising or personal profiling.</p>

  <h2>Information we do not collect</h2>
  <ul>
    <li>Name, email, or contact information</li>
    <li>Location, contacts, photos, microphone, or camera</li>
    <li>Apple ID or device identifiers for tracking</li>
    <li>Payment information (the app is free)</li>
  </ul>

  <h2>Data retention</h2>
  <p>Bot requests are processed to return a move. We do not build user profiles from gameplay.</p>

  <h2>Third-party services</h2>
  <p>Traffic is handled by Cloudflare (edge) and AWS App Runner (engine backend) under their respective policies.</p>

  <h2>Open source</h2>
  <p>Source code: <a href="https://github.com/sahasrarjn/chess-app">github.com/sahasrarjn/chess-app</a> (GPL v3).</p>

  <h2>Changes</h2>
  <p>We may update this policy; the date above will change when we do.</p>

  <hr>
  <p><a href="https://github.com/sahasrarjn/chess-app/blob/main/PRIVACY.md">Markdown version on GitHub</a></p>
</div>
</body>
</html>`;
