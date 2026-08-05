const POKE_API = "https://pokeapi.co/api/v2";
const TCG_API = "https://api.pokemontcg.io/v2/cards";

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

export async function getBootstrapData() {
  const [generationList, tcgResult] = await Promise.all([
    fetchJson(`${POKE_API}/generation?limit=100`),
    fetchJson(`${TCG_API}?pageSize=250&orderBy=-set.releaseDate`).catch(() => ({ data: [] })),
  ]);

  const generationRefs = generationList.results
    .map((gen) => ({ ...gen, id: Number(gen.url.match(/\/(\d+)\/?$/)?.[1]) }))
    .filter((gen) => Number.isFinite(gen.id))
    .sort((a, b) => a.id - b.id);

  const generations = await Promise.all(generationRefs.map(async (gen) => {
    const detail = await fetchJson(gen.url);
    return {
      id: detail.id,
      name: detail.names?.find((entry) => entry.language.name === "en")?.name || `Generation ${detail.id}`,
      region: detail.main_region?.name || "",
      species: detail.pokemon_species.map((species) => ({
        id: Number(species.url.match(/\/(\d+)\/?$/)?.[1]),
        name: species.name,
        displayName: species.name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
        generation: detail.id,
      })),
    };
  }));

  return {
    generations,
    pokemon: generations.flatMap((gen) => gen.species).filter((entry) => Number.isFinite(entry.id)).sort((a, b) => a.id - b.id),
    cards: tcgResult.data || [],
  };
}

export default async function handler(request, response) {
  try {
    response.setHeader("Cache-Control", "public, max-age=3600");
    response.status(200).json(await getBootstrapData());
  } catch (error) {
    console.error(error);
    response.status(502).json({ error: "Could not load game data." });
  }
}
