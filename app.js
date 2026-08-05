import { recordDailyCompletion } from "./src/auth.js";
const POKE_API = "https://pokeapi.co/api/v2";
const TCG_API = "https://api.pokemontcg.io/v2/cards";
const CACHE_KEY = "pokedole:v2:pokedex";

const CHALLENGES = {
  attributes: {
    label: "Attributes",
    prompt: "Which Pokemon matches this picture?",
    hint: "Green is exact, yellow is partial, red is incorrect.",
  },
  card: {
    label: "Card Blur",
    prompt: "Which Pokemon is on this card?",
    hint: "Each wrong guess unblurs the card a bit.",
  },
  entry: {
    label: "Dex Entry",
    prompt: "Which Pokemon has this Pokedex description?",
    hint: "The Pokemon name is hidden from the entry.",
  },
  silhouette: {
    label: "Silhouette",
    prompt: "Which Pokemon is this silhouette of?",
    hint: "Each wrong guess zooms out a bit.",
  },
};

const CHALLENGE_ORDER = ["attributes", "card", "entry", "silhouette"];
const evolutionStageCache = new Map();

const state = {
  roundMode: "daily",
  challenge: "attributes",
  generations: [],
  activeGenerations: new Set(),
  pokemon: [],
  answers: new Map(),
  answer: null,
  answerDetails: null,
  card: null,
  guesses: [],
  completed: new Map(),
  unlockedIndex: 0,
  finished: false,
  hasStarted: false,
  revealedTypeHints: new Set(),
};

const els = {
  setupScreen: document.querySelector("#setupScreen"),
  gameScreen: document.querySelector("#gameScreen"),
  startGameBtn: document.querySelector("#startGameBtn"),
  setupStatus: document.querySelector("#setupStatus"),
  changeSettingsBtn: document.querySelector("#changeSettingsBtn"),
  dailyBtn: document.querySelector("#dailyBtn"),
  randomBtn: document.querySelector("#randomBtn"),
  challengeButtons: [...document.querySelectorAll(".challenge-button")],
  generationFilters: document.querySelector("#generationFilters"),
  guessForm: document.querySelector("#guessForm"),
  guessInput: document.querySelector("#guessInput"),
  guessButton: document.querySelector("#guessButton"),
  pokemonOptions: document.querySelector("#pokemonOptions"),
  status: document.querySelector("#status"),
  guessBody: document.querySelector("#guessBody"),
  simpleBoard: document.querySelector("#simpleBoard"),
  attributeBoard: document.querySelector("#attributeBoard"),
  guessCount: document.querySelector("#guessCount"),
  roundLabel: document.querySelector("#roundLabel"),
  clueStage: document.querySelector("#clueStage"),
  pokemonImage: document.querySelector("#pokemonImage"),
  cardImage: document.querySelector("#cardImage"),
  entryText: document.querySelector("#entryText"),
  cluePrompt: document.querySelector("#cluePrompt"),
  clueHint: document.querySelector("#clueHint"),
  typeHints: document.querySelector("#typeHints"),
  resultsPanel: document.querySelector("#resultsPanel"),
};

init();

async function init() {
  setBusy(true);
  bindEvents();

  try {
    const data = await loadPokedex();
    state.generations = data.generations;
    state.pokemon = data.pokemon;
    state.activeGenerations = new Set(state.generations.map((gen) => gen.id));
    renderGenerationFilters();
    renderDatalist();
    updateRoundButtons();
    updateChallengeButtons();
    showSetup("Choose Daily or Random, pick generations, then start.");
  } catch (error) {
    console.error(error);
    setStatus("Could not load Pokemon data. Check your connection and refresh.", "lose");
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  els.dailyBtn.addEventListener("click", () => setRoundMode("daily"));
  els.randomBtn.addEventListener("click", () => setRoundMode("random"));
  els.startGameBtn.addEventListener("click", () => startRound(state.roundMode));
  els.changeSettingsBtn.addEventListener("click", () => showSetup("Adjust your run settings, then start a new game."));
  els.guessForm.addEventListener("submit", handleGuess);
  els.guessInput.addEventListener("input", () => renderDatalist(els.guessInput.value));
  els.challengeButtons.forEach((button) => {
    button.addEventListener("click", () => switchChallenge(button.dataset.challenge));
  });
  els.typeHints.addEventListener("click", (event) => {
    const button = event.target.closest("[data-type-hint]");
    if (!button) return;
    revealTypeHint(Number(button.dataset.typeHint));
  });
}

function showSetup(message = "") {
  state.hasStarted = false;
  els.setupScreen.hidden = false;
  els.gameScreen.hidden = true;
  els.changeSettingsBtn.hidden = true;
  if (message) els.setupStatus.textContent = message;
  setBusy(false);
}

function showGame() {
  els.setupScreen.hidden = true;
  els.gameScreen.hidden = false;
  els.changeSettingsBtn.hidden = false;
}

function selectionSummary() {
  const count = state.activeGenerations.size;
  return `${count} ${pluralize("generation", count)} selected. ${state.roundMode === "daily" ? "Daily resets at midnight UTC." : "Random creates a fresh sequence each start."}`;
}
async function loadPokedex() {
  const cached = readCache();
  if (cached) return cached;

  const payload = { ...(await fetchJson("/api/bootstrap")), savedAt: Date.now() };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  return payload;
}

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    const isFresh = cached && Date.now() - cached.savedAt < 1000 * 60 * 60 * 24 * 7;
    return isFresh ? cached : null;
  } catch {
    return null;
  }
}

function setRoundMode(roundMode) {
  state.roundMode = roundMode;
  updateRoundButtons();
  showSetup(roundMode === "daily" ? "Daily resets at midnight UTC." : "Random creates a fresh sequence each start.");
}

async function startRound(roundMode = state.roundMode) {
  if (!state.pokemon.length || !state.activeGenerations.size) return;

  state.roundMode = roundMode;
  state.hasStarted = true;
  showGame();
  state.challenge = CHALLENGE_ORDER[0];
  state.answers.clear();
  state.completed.clear();
  state.unlockedIndex = 0;
  hideResults();
  updateRoundButtons();
  await setupChallenge(state.challenge);
}

async function switchChallenge(challenge) {
  if (!CHALLENGES[challenge] || challenge === state.challenge) return;
  if (!isChallengeUnlocked(challenge)) {
    setStatus(`Finish ${CHALLENGES[CHALLENGE_ORDER[state.unlockedIndex]].label} to unlock that game.`);
    updateChallengeButtons();
    return;
  }

  if (state.completed.has(challenge)) {
    const result = state.completed.get(challenge);
    setStatus(`${CHALLENGES[challenge].label} is already complete: ${result.guesses} ${pluralize("guess", result.guesses)}.`);
    updateChallengeButtons();
    return;
  }

  state.challenge = challenge;
  await setupChallenge(challenge);
}

async function setupChallenge(challenge) {
  state.challenge = challenge;
  state.guesses = [];
  state.finished = false;
  state.answerDetails = null;
  state.card = null;
  state.revealedTypeHints.clear();
  els.guessBody.innerHTML = "";
  els.simpleBoard.innerHTML = "";
  els.guessInput.value = "";
  resetClueStage();
  updateChallengeButtons();
  updateBoards();
  updateGuessCount();
  hideResults();
  setBusy(true);
  setStatus("Choosing a mystery Pokemon...");

  try {
    if (challenge === "card") {
      const cardAnswer = await getCardAnswerForChallenge();
      state.answer = cardAnswer.answer;
      state.card = cardAnswer.card;
    } else {
      state.answer = getAnswerForChallenge(challenge);
    }

    const details = await getPokemonDetails(state.answer);
    state.answerDetails = details;

    renderClue();
    setStatus(`${CHALLENGES[challenge].label} ready. Keep guessing until you solve it.`);
  } catch (error) {
    console.error(error);
    setStatus("That mode could not load completely. Try random or another generation.", "lose");
  } finally {
    setBusy(false);
  }
}
async function getCardAnswerForChallenge() {
  const pool = state.pokemon.filter((entry) => state.activeGenerations.has(entry.generation));
  const key = `${state.roundMode}:${dailySeedKey("card")}:card-only`;
  if (state.answers.has(key) && state.card) {
    return { answer: state.answers.get(key), card: state.card };
  }

  const startIndex = state.roundMode === "daily"
    ? seededIndex(pool.length, dailySeedKey("card"))
    : cryptoRandom(pool.length);

  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const answer = pool[(startIndex + attempt) % pool.length];
    const card = await getCardArt(answer);
    if (card) {
      state.answers.set(key, answer);
      return { answer, card };
    }
  }

  throw new Error("No Pokemon TCG cards found for the selected generations.");
}
function getAnswerForChallenge(challenge) {
  const pool = state.pokemon.filter((entry) => state.activeGenerations.has(entry.generation));
  const key = `${state.roundMode}:${dailySeedKey(challenge)}:${[...state.activeGenerations].join("-")}`;
  if (state.answers.has(key)) return state.answers.get(key);

  const index = state.roundMode === "daily"
    ? seededIndex(pool.length, dailySeedKey(challenge))
    : cryptoRandom(pool.length);
  const answer = pool[index];
  state.answers.set(key, answer);
  return answer;
}

function resetClueStage() {
  els.clueStage.className = `clue-stage stage-${state.challenge}`;
  els.clueStage.style.removeProperty("--blur");
  els.clueStage.style.removeProperty("--zoom");
  els.clueStage.style.removeProperty("--pan-x");
  els.clueStage.style.removeProperty("--pan-y");
  els.pokemonImage.removeAttribute("src");
  els.cardImage.removeAttribute("src");
  els.entryText.textContent = "";
  els.typeHints.innerHTML = "";
  els.cluePrompt.textContent = CHALLENGES[state.challenge].prompt;
  els.clueHint.textContent = CHALLENGES[state.challenge].hint;
}

function renderClue() {
  const details = state.answerDetails;
  els.roundLabel.textContent = state.roundMode === "daily" ? "Daily" : "Random";

  if (state.challenge === "attributes") {
    els.clueStage.classList.add("no-visual");
    els.cluePrompt.textContent = "Guess the Pokemon from attribute feedback.";
    return;
  }

  if (state.challenge === "card") {
    els.cardImage.src = state.card.images.large;
    els.cardImage.alt = `Blurred ${state.card.name} Pokemon card`;
    els.clueStage.classList.add("has-card");
    updateProgressiveReveal();
    return;
  }

  if (state.challenge === "entry") {
    els.entryText.textContent = redactedEntry(details);
    els.clueStage.classList.add("has-entry");
    return;
  }

  if (state.challenge === "silhouette") {
    els.pokemonImage.src = details.sprite;
    els.pokemonImage.alt = "Black Pokemon silhouette";
    els.clueStage.classList.add("has-pokemon");
    updateProgressiveReveal();
  }
}

async function handleGuess(event) {
  event.preventDefault();
  if (state.finished || !state.answer) return;

  const guess = findGuess(els.guessInput.value);
  if (!guess) {
    setStatus("Pick a Pokemon from the list.");
    return;
  }

  if (state.guesses.some((entry) => entry.name === guess.name)) {
    setStatus(`${guess.displayName} is already on the board.`);
    return;
  }

  setBusy(true);
  setStatus(`Checking ${guess.displayName}...`);

  try {
    const details = await getPokemonDetails(guess);
    const correct = guess.name === state.answer.name;
    state.guesses.unshift(details);

    if (state.challenge === "attributes") {
      renderAttributeGuess(details);
    } else {
      renderSimpleGuess(details, correct);
    }

    els.guessInput.value = "";
    updateGuessCount();
    updateProgressiveReveal();
    renderTypeHints();

    if (correct) {
      finishRound();
    } else {
      setStatus(`${state.guesses.length} ${pluralize("guess", state.guesses.length)} made. Keep going.`);
    }
  } catch (error) {
    console.error(error);
    setStatus("That Pokemon could not be checked. Try another guess.");
  } finally {
    setBusy(false);
  }
}
async function getPokemonDetails(entry) {
  if (entry.details) return entry.details;

  const [species, pokemon] = await Promise.all([
    fetchJson(`${POKE_API}/pokemon-species/${entry.name}`),
    fetchJson(`${POKE_API}/pokemon/${entry.name}`),
  ]);

  const chainUrl = species.evolution_chain?.url || "";
  const chainId = idFromUrl(chainUrl);
  const evolutionStage = await getEvolutionStage(chainUrl, entry.name);
  const details = {
    ...entry,
    color: species.color?.name || "unknown",
    habitat: species.habitat?.name || "unknown",
    isBaby: Boolean(species.is_baby),
    isLegendary: Boolean(species.is_legendary),
    isMythical: Boolean(species.is_mythical),
    evolutionChainId: chainId,
    evolutionStage,
    flavorText: bestFlavorText(species.flavor_text_entries),
    genera: localGenus(species.genera),
    types: pokemon.types
      .sort((a, b) => a.slot - b.slot)
      .map((type) => type.type.name),
    height: pokemon.height,
    weight: pokemon.weight,
    sprite:
      pokemon.sprites.other?.["official-artwork"]?.front_default ||
      pokemon.sprites.other?.home?.front_default ||
      pokemon.sprites.front_default ||
      "",
    icon:
      pokemon.sprites.versions?.["generation-viii"]?.icons?.front_default ||
      pokemon.sprites.front_default ||
      "",
  };

  entry.details = details;
  return details;
}

async function getCardArt(entry) {
  try {
    const params = new URLSearchParams({
      q: `nationalPokedexNumbers:${entry.id}`,
      orderBy: "-set.releaseDate",
      pageSize: "30",
      select: "id,name,supertype,nationalPokedexNumbers,images,set",
    });
    const result = await fetchJson(`${TCG_API}?${params.toString()}`);
    const cards = (result.data || []).filter((card) =>
      card.supertype === "Pokémon" &&
      card.nationalPokedexNumbers?.includes(entry.id) &&
      card.images?.large &&
      cardNameMatchesPokemon(card.name, entry),
    );

    const exact = cards.find((card) => normalizeCardName(card.name) === normalizePokemonCardName(entry.displayName));
    const plain = cards.find((card) => !/[ -](ex|gx|v|vmax|vstar|break|mega)\b/i.test(card.name));
    return exact || plain || cards[0] || null;
  } catch (error) {
    console.warn("Pokemon TCG lookup failed", error);
    return null;
  }
}

function cardNameMatchesPokemon(cardName, entry) {
  return normalizeCardName(cardName).startsWith(normalizePokemonCardName(entry.displayName));
}

function normalizeCardName(name) {
  return normalize(String(name).replace(/\b(ex|gx|vmax|vstar|v-union|v|break|lvx|prime|radiant|shining|dark|light)\b/gi, ""));
}

function normalizePokemonCardName(name) {
  return normalize(String(name).replace(/\b(male|female)\b/gi, ""));
}

function renderTypeHints() {
  if (!canUseTypeHints() || !state.answerDetails || state.finished) {
    els.typeHints.innerHTML = "";
    return;
  }

  const types = state.answerDetails.types;
  const hints = [];
  if (state.guesses.length >= 5) hints.push(typeHintMarkup(0, types[0], "Type 1"));
  if (state.guesses.length >= 8) hints.push(typeHintMarkup(1, types[1], "Type 2"));

  els.typeHints.innerHTML = hints.join("");
}

function typeHintMarkup(index, type, label) {
  if (!type) return `<span class="type-hint empty">${label}: None</span>`;
  if (state.revealedTypeHints.has(index)) {
    return `<span class="type-hint revealed">${label}: ${escapeHtml(titleCase(type))}</span>`;
  }
  return `<button class="type-hint-button" type="button" data-type-hint="${index}">Reveal ${label}</button>`;
}

function revealTypeHint(index) {
  if (!canUseTypeHints()) return;
  const requiredGuesses = index === 0 ? 5 : 8;
  if (state.guesses.length < requiredGuesses) return;
  state.revealedTypeHints.add(index);
  renderTypeHints();
}

function canUseTypeHints() {
  return state.challenge === "card" || state.challenge === "entry";
}
function updateProgressiveReveal() {
  const wrongGuesses = state.guesses.filter((guess) => guess.name !== state.answer.name).length;

  if (state.challenge === "card") {
    const blur = Math.max(0, 24 - wrongGuesses * 4);
    els.clueStage.style.setProperty("--blur", `${blur}px`);
  }

  if (state.challenge === "silhouette") {
    const zoom = Math.max(1, 2.7 - wrongGuesses * 0.28);
    const panX = Math.min(0, -18 + wrongGuesses * 2.4);
    const panY = Math.max(0, 9 - wrongGuesses * 1.1);
    els.clueStage.style.setProperty("--zoom", String(zoom));
    els.clueStage.style.setProperty("--pan-x", `${panX}%`);
    els.clueStage.style.setProperty("--pan-y", `${panY}%`);
  }
}

function renderGenerationFilters() {
  els.generationFilters.innerHTML = "";
  const all = document.createElement("button");
  all.type = "button";
  all.className = "filter-button active";
  all.textContent = "All";
  all.addEventListener("click", () => {
    state.activeGenerations = new Set(state.generations.map((gen) => gen.id));
    updateFilterButtons();
    renderDatalist(els.guessInput.value);
    showSetup(selectionSummary());
  });
  els.generationFilters.append(all);

  state.generations.forEach((gen) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button active";
    button.dataset.generation = String(gen.id);
    button.textContent = `Gen ${gen.id}`;
    button.title = `${gen.name}${gen.region ? ` - ${gen.region}` : ""}`;
    button.addEventListener("click", () => {
      if (state.activeGenerations.has(gen.id) && state.activeGenerations.size > 1) {
        state.activeGenerations.delete(gen.id);
      } else {
        state.activeGenerations.add(gen.id);
      }
      updateFilterButtons();
      renderDatalist(els.guessInput.value);
      showSetup(selectionSummary());
    });
    els.generationFilters.append(button);
  });
}

function updateFilterButtons() {
  const allActive = state.activeGenerations.size === state.generations.length;
  els.generationFilters.querySelector(".filter-button").classList.toggle("active", allActive);
  els.generationFilters.querySelectorAll("[data-generation]").forEach((button) => {
    button.classList.toggle("active", state.activeGenerations.has(Number(button.dataset.generation)));
  });
}

function renderDatalist(query = "") {
  const prefix = normalize(query);
  const matches = state.pokemon
    .filter((entry) => state.activeGenerations.has(entry.generation))
    .filter((entry) => !prefix || normalize(entry.displayName).startsWith(prefix) || normalize(entry.name).startsWith(prefix))
    .slice(0, prefix ? 40 : 80);

  els.pokemonOptions.innerHTML = matches
    .map((entry) => `<option value="${escapeHtml(entry.displayName)}"></option>`)
    .join("");
}

function renderAttributeGuess(guess) {
  const answer = state.answerDetails;
  const row = document.createElement("tr");
  row.className = "reveal-row";
  row.innerHTML = `
    <td class="${cellClass(guess.name === answer.name)}">
      <div class="pokemon-cell">
        ${guess.icon ? `<img src="${guess.icon}" alt="" />` : ""}
        <span>${escapeHtml(guess.displayName)}</span>
      </div>
    </td>
    <td class="${cellClass(typeAt(guess, 0) === typeAt(answer, 0))}">${typeLabel(typeAt(guess, 0))}</td>
    <td class="${cellClass(typeAt(guess, 1) === typeAt(answer, 1))}">${typeLabel(typeAt(guess, 1))}</td>
    <td class="${cellClass(guess.generation === answer.generation)}">${hint(guess.generation, answer.generation, "Gen")}</td>
    <td class="${cellClass(guess.habitat === answer.habitat)}">${escapeHtml(titleCase(guess.habitat))}</td>
    <td class="${colorClass(guess, answer)}">${escapeHtml(titleCase(guess.color))}</td>
    <td class="${cellClass(stageValue(guess) === stageValue(answer))}">${stageValue(guess)}</td>
    <td class="${cellClass(guess.height === answer.height)}">${hint(guess.height * 10, answer.height * 10, "cm")}</td>
    <td class="${cellClass(guess.weight === answer.weight)}">${hint(guess.weight / 10, answer.weight / 10, "kg")}</td>
  `;
  els.guessBody.prepend(row);
}

function renderSimpleGuess(guess, correct) {
  const item = document.createElement("div");
  item.className = `simple-guess ${correct ? "correct" : "wrong"}`;
  item.innerHTML = `
    ${guess.icon ? `<img src="${guess.icon}" alt="" />` : ""}
    <span>${escapeHtml(guess.displayName)}</span>
  `;
  els.simpleBoard.prepend(item);
}

function finishRound() {
  state.finished = true;
  state.completed.set(state.challenge, {
    guesses: state.guesses.length,
    answer: state.answer.displayName,
  });

  els.clueStage.classList.add("revealed");
  els.pokemonImage.alt = state.answer.displayName;
  els.cardImage.alt = state.card ? state.card.name : state.answer.displayName;

  const currentIndex = CHALLENGE_ORDER.indexOf(state.challenge);
  const nextChallenge = CHALLENGE_ORDER[currentIndex + 1];
  if (nextChallenge) {
    state.unlockedIndex = Math.max(state.unlockedIndex, currentIndex + 1);
    updateChallengeButtons();
    setStatus(
      `Correct. ${state.answer.displayName} took ${state.guesses.length} ${pluralize("guess", state.guesses.length)}. ${CHALLENGES[nextChallenge].label} is unlocked.`,
      "win",
    );
    return;
  }

  updateChallengeButtons();
  const streakResult = state.roundMode === "daily" ? recordDailyCompletion() : null;
  const streakMessage = streakResult?.updated
    ? ` ${streakResult.user.streak} day streak.`
    : "";
  setStatus(`${state.roundMode === "daily" ? "Daily" : "Random"} complete. You solved all four games.${streakMessage}`, "win");
  renderResults(streakResult);
}
function findGuess(value) {
  const wanted = normalize(value);
  return state.pokemon.find(
    (entry) =>
      state.activeGenerations.has(entry.generation) &&
      (normalize(entry.displayName) === wanted || normalize(entry.name) === wanted),
  );
}

function updateBoards() {
  const isAttribute = state.challenge === "attributes";
  els.attributeBoard.style.display = isAttribute ? "block" : "none";
  els.simpleBoard.classList.toggle("active", !isAttribute);
}

function updateRoundButtons() {
  els.dailyBtn.classList.toggle("active", state.roundMode === "daily");
  els.randomBtn.classList.toggle("active", state.roundMode === "random");
}

function updateChallengeButtons() {
  els.challengeButtons.forEach((button) => {
    const challenge = button.dataset.challenge;
    const completed = state.completed.has(challenge);
    button.classList.toggle("active", challenge === state.challenge);
    button.classList.toggle("completed", completed);
    button.classList.toggle("locked", !isChallengeUnlocked(challenge));
    button.disabled = !isChallengeUnlocked(challenge);
  });
}

function updateGuessCount() {
  els.guessCount.textContent = `${state.guesses.length} ${pluralize("guess", state.guesses.length)}`;
}

function setBusy(isBusy) {
  els.guessInput.disabled = isBusy || state.finished;
  els.guessButton.disabled = isBusy || state.finished;
  els.dailyBtn.disabled = isBusy && state.hasStarted;
  els.randomBtn.disabled = isBusy && state.hasStarted;
  els.startGameBtn.disabled = isBusy || !state.pokemon.length || !state.activeGenerations.size;
  els.challengeButtons.forEach((button) => {
    button.disabled = isBusy || !isChallengeUnlocked(button.dataset.challenge);
  });
  els.generationFilters.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy && state.hasStarted;
  });
}

function isChallengeUnlocked(challenge) {
  const index = CHALLENGE_ORDER.indexOf(challenge);
  return index >= 0 && index <= state.unlockedIndex;
}

function renderResults(streakResult = null) {
  const rows = CHALLENGE_ORDER.map((challenge) => {
    const result = state.completed.get(challenge);
    return `
      <div class="result-row">
        <span>${escapeHtml(CHALLENGES[challenge].label)}</span>
        <strong>${result.guesses} ${pluralize("guess", result.guesses)}</strong>
        <small>${escapeHtml(result.answer)}</small>
      </div>
    `;
  }).join("");

  const total = [...state.completed.values()].reduce((sum, result) => sum + result.guesses, 0);
  const streakNote = streakResult?.user
    ? `<p>Current streak: <strong>${streakResult.user.streak} ${pluralize("day", streakResult.user.streak)}</strong></p>`
    : state.roundMode === "daily"
      ? `<p>Log in before completing the daily run to track your streak.</p>`
      : "";

  els.resultsPanel.innerHTML = `
    <h2>${state.roundMode === "daily" ? "Daily" : "Random"} Results</h2>
    <div class="result-list">${rows}</div>
    <p>Total: <strong>${total} ${pluralize("guess", total)}</strong></p>
    ${streakNote}
  `;
  els.resultsPanel.classList.add("active");
}

function hideResults() {
  els.resultsPanel.classList.remove("active");
  els.resultsPanel.innerHTML = "";
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}
function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`.trim();
}

function typeAt(entry, index) {
  return entry.types[index] || "none";
}

function typeLabel(type) {
  return escapeHtml(titleCase(type));
}

function colorClass(guess, answer) {
  if (guess.color === answer.color) return "hit";
  if (guess.types.some((type) => answer.types.includes(type))) return "partial";
  return "miss";
}

function cellClass(matches) {
  return matches ? "hit" : "miss";
}

function hint(value, answerValue, unit) {
  const label = `${value}${unit ? ` ${unit}` : ""}`;
  if (Number(value) === Number(answerValue)) return escapeHtml(label);
  const arrow = Number(value) < Number(answerValue) ? "↑" : "↓";
  return `<span class="hint"><span>${escapeHtml(label)}</span><span class="arrow">${arrow}</span></span>`;
}

function stageValue(entry) {
  return String(entry.evolutionStage || 1);
}

async function getEvolutionStage(chainUrl, speciesName) {
  if (!chainUrl) return 1;

  if (!evolutionStageCache.has(chainUrl)) {
    evolutionStageCache.set(chainUrl, fetchJson(chainUrl));
  }

  const chain = await evolutionStageCache.get(chainUrl);
  return findEvolutionDepth(chain.chain, speciesName, 1) || 1;
}

function findEvolutionDepth(node, speciesName, depth) {
  if (!node) return null;
  if (node.species?.name === speciesName) return depth;

  for (const child of node.evolves_to || []) {
    const found = findEvolutionDepth(child, speciesName, depth + 1);
    if (found) return found;
  }

  return null;
}

function bestFlavorText(entries = []) {
  const english = entries.filter((entry) => entry.language.name === "en");
  const preferred = english.find((entry) => ["scarlet", "violet", "sword", "shield"].includes(entry.version.name));
  return cleanFlavorText((preferred || english[0])?.flavor_text || "No Pokedex entry was found.");
}

function redactedEntry(details) {
  let text = details.flavorText || "No Pokedex entry was found.";
  const names = [details.displayName, details.name, ...details.displayName.split(" ")]
    .filter((name) => name.length > 1)
    .sort((a, b) => b.length - a.length);

  names.forEach((name) => {
    text = text.replace(new RegExp(escapeRegExp(name), "gi"), "_____");
  });

  return `"${text}"`;
}

function localGenus(genera = []) {
  return genera.find((entry) => entry.language.name === "en")?.genus || "Pokemon";
}

function cleanFlavorText(text) {
  return text.replace(/[\n\f\r]+/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function seededIndex(length, seed) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % length;
}

function dailySeedKey(challenge) {
  const date = new Date();
  const utcDay = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  const generations = [...state.activeGenerations].sort((a, b) => a - b).join("-");
  return `${utcDay}:${challenge}:${generations}`;
}

function cryptoRandom(length) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

function idFromUrl(url) {
  return Number(url.match(/\/(\d+)\/?$/)?.[1]);
}

function romanGeneration(id) {
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return `Generation ${roman[id - 1] || id}`;
}

function localName(names, fallback) {
  return names?.find((entry) => entry.language.name === "en")?.name || fallback;
}

function formatPokemonName(name) {
  return name
    .split("-")
    .map((part) => {
      if (part === "f") return "F";
      if (part === "m") return "M";
      return titleCase(part);
    })
    .join(" ");
}

function titleCase(value) {
  return String(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}





















