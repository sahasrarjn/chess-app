# Border Chess Privacy Policy

**Last updated:** May 28, 2026  
**Contact:** [GitHub Issues](https://github.com/sahasrarjn/chess-app/issues)

Border Chess (“the app”) is published by Sahasra Ranjan. This policy describes what information is handled when you use the iPhone app, browser game, and related services.

## Summary

- No account, login, or ads.
- **Play with Friend** is fully offline on your device.
- **Play vs Bot** sends chess positions to our server over HTTPS so the engine can reply.
- We do not sell your data.

## Information the app sends

When you use **Play vs Bot**, the app sends:

- The current board position (FEN notation)
- Bot difficulty / think-time settings needed for a move

These requests go to `https://borderchess.org`, which proxies them to our backend engine. Requests are used only to compute bot moves.

Our edge service may also see standard network metadata (for example IP address) for **rate limiting and abuse prevention**. We do not use this to identify you personally or for advertising.

## Information we do not collect

The app does not request or collect:

- Name, email, or contact information
- Location
- Contacts, photos, microphone, or camera data
- Apple ID or device identifiers for tracking
- Payment or financial information (the app is free)

Pass-and-play games stay on your device and are not uploaded.

## Data retention

Bot move requests are processed to return a move. We do not build user profiles from gameplay. Server and edge logs, if any, are kept only as long as needed for operation and security.

## Third-party services

- **Amazon CloudFront** — static site CDN and HTTPS
- **Cloudflare Workers** — rate-limited bot move API proxy
- **AWS App Runner** — private chess engine backend
- **PostHog** (web only) — anonymous usage analytics (page views, basic interaction events). The iPhone app does not use PostHog.

These providers process network traffic according to their own policies.

## Open source

Border Chess is open source under GPL v3: https://github.com/sahasrarjn/chess-app

## Children

The app is suitable for general audiences and does not knowingly collect personal information from children.

## Changes

We may update this policy. The “Last updated” date will change when we do. Continued use of the app after changes means you accept the updated policy.

## Contact

Questions or privacy requests: open an issue at https://github.com/sahasrarjn/chess-app/issues
