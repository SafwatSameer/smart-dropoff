# Smart Drop-off

**Steal the Moment** assignment by Syed Safwat Sameer.

**The moment:** a bike-ride drop-off at POL Depo Canteen Noya Kutum Bari, Dhaka Cantonment. Uber's route ends at the canteen. In Pathao the pin sits right on the canteen, yet the route ends on New Airport Road (N3), across a divided highway, because the Dhaka Elevated Expressway runs right above the canteen's road. That happens on about half of my weekday office trips.

**The fix:** Smart Drop-off.
1. **Route to the drop-off point, not the pin.** Each place gets a drop-off point, learned from where past trips ended well: close to the place, with passengers tapping "right spot". New places start from the map's best guess and improve with every trip.
2. **Your landmark, said once.** What the passenger would tell the rider, saved for next trips.
3. **Rider gets both before accepting.** Plus a short Bangla reminder.

The past trip endings (dots) in the prototype are sample data.

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
