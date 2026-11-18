# Intelligent Decentralized Resource Management System (IDRMS)

This project is a real-time prototype of the adaptive smart grid described in the concept brief. It simulates an intelligent decentralized network for managing the four key resource streams:

- Energy
- Water
- Food
- Knowledge

## Features

- Live resource balancing dashboard
- Real-time simulated sensor updates
- Node-level health and efficiency monitoring
- Dynamic system alerts and network activity
- Live pulse chart for resource flow
- Responsive single-page interface
- Generational interface modes, browser voice/alerts, and a simulated footstep-energy estimate
- Local knowledge shelf with an on-device offline cache
- Quote-based service offers and a SQLite-backed pilot inquiry form with an administrator-only inbox

## Run locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

To access the pilot inquiry inbox, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the server environment before startup. The password must be at least 12 characters. Do not commit credentials. Without these values, no administrator account is provisioned.

## Project structure

- `server.js` — Express + Socket.IO live data server
- `public/index.html` — dashboard layout
- `public/styles.css` — visual design and responsive layout
- `public/app.js` — realtime rendering and chart updates

## Notes

This is a working prototype demonstrating how the system behaves in real time, rather than a production utility-grade control system. Sensor and kinetic readings are simulated, and pilot requests are stored only in the local SQLite database; the app does not send email or collect payment. Do not use prototype readings to promise savings. Production use requires real meter integrations, secure session configuration, deployment hardening, and any applicable utility, privacy, and energy-market approvals.
