# UL Online — Wiki Home

Welcome to the UL Online wiki. This is the place for quick orientation — both for people who just want to use the app and for developers who want to dig into the code.

For full setup instructions, environment variables, and available scripts, the **[README](../README.md)** is the authoritative reference. This wiki supplements it rather than repeating it.

---

## What is UL Online?

UL Online is a live transit map built around Uppsala Lokaltrafik (UL) bus data. Open it on your phone, let it find your location, and you can see every bus currently moving in the city — along with which ones you can actually reach on foot before they leave.

![Screenshot placeholder — main map view showing live bus positions and stop markers around central Uppsala](images/screenshot-map-main.png)

> **Image needed:** A screenshot of the main map view with the app open on a mobile device, showing coloured bus icons moving across the map, orange stop markers, and the user's location pin with a green reach circle around it.

The core idea is simple: rather than hunting through a timetable app, you glance at the map, see how far away the nearest bus is, and decide whether to walk, jog, or put the kettle on.

---

## Pages in this wiki

| Page | Who it's for |
|------|-------------|
| [User Guide](User-Guide) | Anyone using the app |
| [Architecture](Architecture) | Developers wanting the big picture |
| [Configuration](Configuration) | Developers setting up a local environment |
| [Development Guide](Development-Guide) | Running, testing, and building locally |
| [Data Model](Data-Model) | The GTFS tables and how they fit together |
| [Contributing](Contributing) | How to open a PR |

---

## Quick links

- **Live app** — [https://ul-online.web.app](https://ul-online.web.app) *(URL may vary — check the project README)*
- **README** — [../README.md](../README.md)
- **Issue tracker** — [GitHub Issues](https://github.com/deanmcgowan/ul-online/issues)

---

## At a glance

- Built with React + TypeScript, bundled by Vite
- Maps rendered by OpenLayers with a Mapbox-style base layer
- Backend is Supabase (PostgreSQL + Edge Functions)
- Transit data comes from [Trafiklab](https://www.trafiklab.se/) — static GTFS for routes/stops, GTFS-RT for live positions
- Journey planning uses the ResRobot API via Trafiklab
- Works as a Progressive Web App (PWA) — add to home screen on iOS or Android
