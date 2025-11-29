const GRID = document.getElementById("grid");
const FORM = document.getElementById("guess-form");
const INPUT = document.getElementById("guess-input");
const MESSAGE = document.getElementById("message");

const HINT_SLOT = document.getElementById("hint-slot");
const HINT_PRICE = document.getElementById("hint-price");
const HINT_RELEASE = document.getElementById("hint-release");
const LETTERS_INFO = document.getElementById("letters-info");

const RESULT_PANEL = document.getElementById("result-panel");
const RESULT_TITLE = document.getElementById("result-title");
const RESULT_ICON = document.getElementById("result-icon");
const RESULT_NAME = document.getElementById("result-name");
const RESULT_SLOT = document.getElementById("result-slot");
const RESULT_GE = document.getElementById("result-ge");
const RESULT_RELEASE = document.getElementById("result-release");
const PLAY_AGAIN = document.getElementById("play-again");

const SUGGESTIONS_BOX = document.getElementById("suggestions");

const MAX_GUESSES = 6;

let items = [];
let answerItem = null;
let answerClean = "";
let answerLetters = [];
let currentGuess = 0;
let gameOver = false;

// autocomplete state
let currentSuggestions = [];
let highlightedIndex = -1;

// --- Helpers ---

function normalizeForCompare(name) {
  // Lowercase and keep only a-z for comparison
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function priceBand(price) {
  if (price == null) return "Unknown";
  if (price < 1000) return "< 1k";
  if (price < 10_000) return "1k–10k";
  if (price < 100_000) return "10k–100k";
  if (price < 1_000_000) return "100k–1m";
  if (price < 10_000_000) return "1m–10m";
  return "10m+";
}

function formatNumber(n) {
  if (n == null) return "Unknown";
  return n.toLocaleString("en-US");
}

function formatReleaseDate(dateStr) {
  if (!dateStr) return "Unknown";
  return dateStr;
}

// Wordle-style scoring
function scoreGuess(guess, answer) {
  const result = Array(guess.length).fill("absent");
  const answerArr = answer.split("");

  // First pass: exact matches
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answerArr[i]) {
      result[i] = "correct";
      answerArr[i] = null;
    }
  }

  // Second pass: present but wrong position
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === "correct") continue;
    const idx = answerArr.indexOf(guess[i]);
    if (idx !== -1) {
      result[i] = "present";
      answerArr[idx] = null;
    }
  }

  return result;
}

function clearGrid() {
  GRID.innerHTML = "";
}

// Build empty grid rows (for display)
function buildGrid(letterCount) {
  clearGrid();
  for (let row = 0; row < MAX_GUESSES; row++) {
    const rowDiv = document.createElement("div");
    rowDiv.className = "grid-row";
    rowDiv.dataset.rowIndex = row;
    for (let col = 0; col < letterCount; col++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.colIndex = col;
      rowDiv.appendChild(tile);
    }
    GRID.appendChild(rowDiv);
  }
}

function renderGuessRow(rowIndex, guessLetters, scoring) {
  const rowDiv = GRID.querySelector(`.grid-row[data-row-index="${rowIndex}"]`);
  if (!rowDiv) return;

  const tiles = rowDiv.querySelectorAll(".tile");
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const letter = guessLetters[i] || "";
    tile.textContent = letter.toUpperCase();
    const state = scoring[i] || "absent";
    tile.classList.remove("correct", "present", "absent");
    tile.classList.add(state);
  }
}

function setMessage(text, isError = false) {
  MESSAGE.textContent = text;
  MESSAGE.style.color = isError ? "#ffb3b3" : "#f1d18a";
}

function revealResult(win) {
  gameOver = true;
  FORM.querySelector("button[type='submit']").disabled = true;
  INPUT.disabled = true;

  hideSuggestions();

  RESULT_PANEL.classList.remove("hidden");
  RESULT_TITLE.textContent = win ? "You got it!" : "Out of guesses!";

  RESULT_ICON.src = answerItem.icon;
  RESULT_ICON.alt = answerItem.name;
  RESULT_NAME.textContent = answerItem.name;
  RESULT_SLOT.textContent = answerItem.slot || "none";
  RESULT_GE.textContent = `${formatNumber(
    answerItem.ge_price
  )} gp (${priceBand(answerItem.ge_price)})`;
  RESULT_RELEASE.textContent = formatReleaseDate(answerItem.release_date);
}

// --- Autocomplete (suggestions) ---

function hideSuggestions() {
  SUGGESTIONS_BOX.classList.add("hidden");
  SUGGESTIONS_BOX.innerHTML = "";
  currentSuggestions = [];
  highlightedIndex = -1;
}

function showSuggestions() {
  if (currentSuggestions.length === 0) {
    hideSuggestions();
    return;
  }
  SUGGESTIONS_BOX.classList.remove("hidden");
}

function updateSuggestions(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    hideSuggestions();
    return;
  }

  // Simple contains filter, prioritize starts-with
  const matches = items
    .filter((it) => it.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const aStarts = an.startsWith(q);
      const bStarts = bn.startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return an.localeCompare(bn);
    })
    .slice(0, 25); // cap suggestions for performance

  currentSuggestions = matches;
  highlightedIndex = -1;

  if (matches.length === 0) {
    hideSuggestions();
    return;
  }

  SUGGESTIONS_BOX.innerHTML = "";
  matches.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "suggestion-item";
    row.dataset.index = index.toString();

    const icon = document.createElement("img");
    icon.className = "suggestion-icon";
    icon.src = item.icon;
    icon.alt = item.name;

    const nameSpan = document.createElement("span");
    nameSpan.className = "suggestion-name";
    nameSpan.textContent = item.name;

    row.appendChild(icon);
    row.appendChild(nameSpan);

    row.addEventListener("mouseenter", () => {
      setHighlightedIndex(index);
    });

    row.addEventListener("mouseleave", () => {
      setHighlightedIndex(-1);
    });

    row.addEventListener("mousedown", (e) => {
      // prevent input from losing focus before click handler finishes
      e.preventDefault();
      chooseSuggestion(index);
    });

    SUGGESTIONS_BOX.appendChild(row);
  });

  showSuggestions();
}

function setHighlightedIndex(newIndex) {
  const itemsDom = Array.from(
    SUGGESTIONS_BOX.querySelectorAll(".suggestion-item")
  );
  itemsDom.forEach((el) => el.classList.remove("active"));

  highlightedIndex = newIndex;
  if (highlightedIndex >= 0 && highlightedIndex < itemsDom.length) {
    itemsDom[highlightedIndex].classList.add("active");
  }
}

function moveHighlight(delta) {
  if (currentSuggestions.length === 0) return;

  let newIndex = highlightedIndex + delta;
  if (newIndex < 0) newIndex = currentSuggestions.length - 1;
  if (newIndex >= currentSuggestions.length) newIndex = 0;
  setHighlightedIndex(newIndex);
}

function chooseSuggestion(index) {
  if (index < 0 || index >= currentSuggestions.length) return;
  const item = currentSuggestions[index];
  INPUT.value = item.name;
  hideSuggestions();
  setMessage("");
}

// --- Game setup ---

async function loadItems() {
  try {
    const resp = await fetch("osrs_game_items.json");
    if (!resp.ok) throw new Error("Failed to load osrs_game_items.json");
    const data = await resp.json();
    items = data;
  } catch (err) {
    console.error(err);
    setMessage("Error loading item data. Check console.", true);
  }
}

function startNewGame() {
  if (!items || items.length === 0) {
    setMessage("No items loaded yet.", true);
    return;
  }

  RESULT_PANEL.classList.add("hidden");
  FORM.querySelector("button[type='submit']").disabled = false;
  INPUT.disabled = false;
  INPUT.value = "";
  INPUT.focus();
  setMessage("");
  hideSuggestions();

  gameOver = false;
  currentGuess = 0;

  // Pick random item
  answerItem = items[Math.floor(Math.random() * items.length)];
  answerClean = normalizeForCompare(answerItem.name);
  answerLetters = answerClean.split("");

  buildGrid(answerLetters.length);

  // Set hints
  HINT_SLOT.textContent = answerItem.slot || "none";
  HINT_PRICE.textContent = priceBand(answerItem.ge_price);
  HINT_RELEASE.textContent = formatReleaseDate(answerItem.release_date);
  LETTERS_INFO.textContent = `Answer length: ${answerLetters.length} letters (excluding spaces/punctuation).`;
}

// --- Events ---

// Input typing -> update suggestions
INPUT.addEventListener("input", () => {
  if (gameOver) return;
  updateSuggestions(INPUT.value);
});

// Keyboard navigation for suggestions
INPUT.addEventListener("keydown", (e) => {
  if (gameOver) return;

  if (SUGGESTIONS_BOX.classList.contains("hidden")) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveHighlight(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveHighlight(-1);
  } else if (e.key === "Enter") {
    // If we have a highlighted suggestion, choose it instead of submitting
    if (highlightedIndex >= 0) {
      e.preventDefault();
      chooseSuggestion(highlightedIndex);
    }
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

FORM.addEventListener("submit", (e) => {
  e.preventDefault();
  if (gameOver) return;

  const rawGuess = INPUT.value.trim();
  if (!rawGuess) {
    setMessage("Enter an item name.", true);
    return;
  }

  const guessClean = normalizeForCompare(rawGuess);

  // Make sure guess is a real OSRS item (by normalized name)
  const validGuess = items.find(
    (it) => normalizeForCompare(it.name) === guessClean
  );

  if (!validGuess) {
    setMessage("Not a valid OSRS item. Try again.", true);
    return;
  }

  hideSuggestions();

  const scoring = scoreGuess(guessClean, answerClean);
  const guessLetters = guessClean.split("");

  renderGuessRow(currentGuess, guessLetters, scoring);

  currentGuess += 1;

  if (guessClean === answerClean) {
    setMessage("Correct!", false);
    revealResult(true);
    return;
  }

  if (currentGuess >= MAX_GUESSES) {
    setMessage(`The item was: ${answerItem.name}`, true);
    revealResult(false);
    return;
  }

  setMessage(`Not quite. You have ${MAX_GUESSES - currentGuess} guesses left.`);
  INPUT.value = "";
  INPUT.focus();
});

PLAY_AGAIN.addEventListener("click", () => {
  startNewGame();
});

// --- Init ---

(async function init() {
  await loadItems();
  if (items.length > 0) {
    startNewGame();
  }
})();
