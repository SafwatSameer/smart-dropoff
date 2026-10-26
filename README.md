# Smart Drop-off

**Steal the Moment** assignment by Syed Safwat Sameer.

**The moment:** a bike-ride drop-off at POL Depo Canteen Noya Kutum Bari, Dhaka Cantonment. Uber's route ends at the canteen. Pathao's pin lands on the Dhaka Elevated Expressway, so riders stop on New Airport Road (N3), across a divided highway. That happens on about half of my weekday office trips.

**The fix:** Smart Drop-off.
- **Backend:** access-aware snapping. A drop-off never snaps to a road where bikes can't stop (elevated, ramps, motorways, no-motorcycle roads).
- **Passenger:** confirm your gate once. It's saved to the place.
- **Rider:** sees the gate, the turn and a Bangla note before accepting. Ending a trip far from the gate needs the passenger's OK.

| | Link |
|---|---|
| Q4 · One-slide proposal | [`/slide/`](slide/) (PNG and PDF downloads on the page) |
| Q5 · Clickable prototype | [`/prototype/`](prototype/) |

## How it's built
- Plain HTML, CSS and JS. No build step.
- Map: [Leaflet](https://leafletjs.com/) with OpenStreetMap tiles.
- Road geometry and distances: OpenStreetMap via the Overpass API.
- Routes: OSRM (`routing.openstreetmap.de`), fetched on 27 Oct 2026 and stored in `prototype/data.js`, so the prototype works without any live routing calls.
- Rider name, fare and ETA are sample data.

Concept work for a job assessment. Not affiliated with Pathao or Uber.
