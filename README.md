# Pokedole 2.0

A browser-based Pokemon guessing game inspired by Pokedle-style daily challenges.

## Modes

- Attributes: guess from Pokemon attributes and feedback.
- Card Blur: guess a blurred Pokemon TCG card as it gradually clears.
- Dex Entry: guess from a redacted Pokedex entry.
- Silhouette: guess a zoomed-in Pokemon silhouette that gradually zooms out.

## Run Locally

Serve the folder with any static web server. For example:

```powershell
python -m http.server 5174 --bind 127.0.0.1
```

Then open `http://127.0.0.1:5174/`.

## Data Sources

- PokeAPI for Pokemon, species, evolution, and Pokedex data.
- Pokemon TCG API for card images.
