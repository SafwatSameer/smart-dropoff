# Smart Drop-off

**Steal the Moment** assignment by Syed Safwat Sameer.

**The moment:** a bike-ride drop-off at POL Depo Canteen Noya Kutum Bari, Dhaka Cantonment. Uber's route ends at the canteen. Pathao's pin lands on the Dhaka Elevated Expressway, so riders stop on New Airport Road (N3), across a divided highway. That happens on about half of my weekday office trips.

**The fix:** Smart Drop-off.
1. **Picks a spot bikes can stop at.** A drop-off never lands on a road bikes can't use (expressways, ramps, no-motorcycle roads).
2. **Remembers your spot and tips.** One-tap confirm, plus an optional tip in the passenger's own words, saved for next trips.
3. **Rider sees both before accepting.** Plus a short Bangla reminder, and a safety reminder if the spot is on a highway.

| | Link |
|---|---|
| Q4 · One-slide proposal | [`/slide/`](slide/) (PNG and PDF downloads on the page) |
| Q5 · Clickable prototype | [`/prototype/`](prototype/) |

## How it's built
- Plain HTML, CSS and JS. No build step.
- Map: [MapLibre GL JS](https://maplibre.org/) with the OpenFreeMap "Positron" style (OpenStreetMap data).
- Road geometry and distances: OpenStreetMap via the Overpass API.
- Routes: OSRM (`routing.openstreetmap.de`), fetched on 27 Oct 2026 and stored in `prototype/data.js`, so the prototype works without any live routing calls.
- Rider name, fare and ETA are sample data.

Concept work for a job assessment. Not affiliated with Pathao or Uber.
