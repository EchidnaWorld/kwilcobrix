const SUPABASE_URL = "https://TON-PROJET.supabase.co";
const SUPABASE_ANON_KEY = "TA_CLE_ANON";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const COLORS = [
  "green",
  "blue",
  "purple",
  "orange"
];

const PLAYER_COLORS = {
  green: "#31964d",
  blue: "#3477ba",
  purple: "#8552a4",
  orange: "#d57925",
  ghost: "#af4a75",
  neutral: "#222"
};

let game = null;
let gameCode = null;
let playerId = localStorage.getItem("kwilcobrix_player_id");

if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem("kwilcobrix_player_id", playerId);
}

let realtimeChannel = null;
let selectedStackId = null;
let selectedAction = null;
let selectedColor = null;

const $ = id => document.getElementById(id);

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.add("hidden");
  });

  $(screenId).classList.remove("hidden");
}

function setMessage(id, message) {
  $(id).textContent = message || "";
}

function randomCode() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

function createEmptyGame(code, hostName) {
  return {
    code,
    status: "waiting",
    hostId: playerId,
    currentPlayerIndex: 0,
    neutralPawnsRemaining: 14,
    plusOneAvailable: true,
    minusOneAvailable: true,
    turnSubterfugeUsed: false,
    stacks: [],
    players: [
      {
        id: playerId,
        name: hostName,
        color: COLORS[0],
        isGhost: false,
        pawnsRemaining: 10,
        sacrifices: 0,
        score: 0
      }
    ],
    ghost: null,
    lastPlacedStackId: null,
    lastDifference: 0,
    winnerId: null
  };
}

async function saveGame() {
  const { error } = await supabaseClient
    .from("games")
    .upsert({
      id: game.code,
      state: game,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error(error);
    alert("Impossible de synchroniser la partie.");
  }
}

async function loadGame(code) {
  const { data, error } = await supabaseClient
    .from("games")
    .select("*")
    .eq("id", code)
    .single();

  if (error || !data) {
    return null;
  }

  return data.state;
}

function subscribeToGame(code) {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel(`game-${code}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "games",
        filter: `id=eq.${code}`
      },
      payload => {
        if (payload.new && payload.new.state) {
          game = payload.new.state;
          render();
        }
      }
    )
    .subscribe(status => {
      $("connectionStatus").textContent =
        status === "SUBSCRIBED"
          ? "Connecté"
          : "Connexion...";
    });
}

async function createGame() {
  const name = $("playerNameInput").value.trim();

  if (!name) {
    setMessage("homeMessage", "Entre ton nom.");
    return;
  }

  gameCode = randomCode();
  game = createEmptyGame(gameCode, name);

  await saveGame();
  subscribeToGame(gameCode);
  openLobby();
}

async function joinGame() {
  const name = $("playerNameInput").value.trim();
  const code = $("gameCodeInput").value.trim().toUpperCase();

  if (!name || !code) {
    setMessage("homeMessage", "Entre ton nom et un code.");
    return;
  }

  const loadedGame = await loadGame(code);

  if (!loadedGame) {
    setMessage("homeMessage", "Partie introuvable.");
    return;
  }

  if (loadedGame.status !== "waiting") {
    setMessage("homeMessage", "Cette partie a déjà commencé.");
    return;
  }

  if (loadedGame.players.length >= 4) {
    setMessage("homeMessage", "Cette partie est complète.");
    return;
  }

  const usedColors = loadedGame.players.map(player => player.color);
  const availableColor = COLORS.find(color => !usedColors.includes(color));

  loadedGame.players.push({
    id: playerId,
    name,
    color: availableColor,
    isGhost: false,
    pawnsRemaining: 10,
    sacrifices: 0,
    score: 0
  });

  gameCode = code;
  game = loadedGame;

  await saveGame();
  subscribeToGame(gameCode);
  openLobby();
}

function openLobby() {
  $("gameCodeLabel").textContent = game.code;
  showScreen("lobbyScreen");
  renderLobby();
}

function renderLobby() {
  const list = $("lobbyPlayers");
  list.innerHTML = "";

  game.players.forEach(player => {
    const li = document.createElement("li");
    li.textContent = `${player.name} — ${player.color}`;
    list.appendChild(li);
  });

  const isHost = game.hostId === playerId;
  $("startGameButton").disabled = !isHost || game.players.length < 2;

  if (game.players.length === 1) {
    setMessage("lobbyMessage", "Il faut au moins deux joueurs.");
  } else {
    setMessage("lobbyMessage", "La partie peut commencer.");
  }
}

async function startGame() {
  if (game.players.length === 2) {
    game.ghost = {
      id: "ghost",
      name: "Joueur fantôme",
      color: "ghost",
      isGhost: true,
      pawnsRemaining: 10,
      sacrifices: 0,
      score: 0
    };
  }

  game.status = "playing";
  game.currentPlayerIndex = 0;
  game.turnSubterfugeUsed = false;

  await saveGame();
  showScreen("gameScreen");
  render();
}

function getAllPlayers() {
  const players = [...game.players];

  if (game.ghost) {
    players.push(game.ghost);
  }

  return players;
}

function getCurrentPlayer() {
  return game.players[game.currentPlayerIndex];
}

function playerCanPlay() {
  const current = getCurrentPlayer();
  return current && current.id === playerId;
}

function getNextAvailablePosition() {
  if (game.stacks.length === 0) {
    return 0;
  }

  return game.stacks.length;
}

function positionToCoordinates(position, total) {
  const angle = (position / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;

  const radius = 38;

  return {
    left: 50 + Math.cos(angle) * radius,
    top: 50 + Math.sin(angle) * radius
  };
}

function getNeighbors(stackIndex) {
  const stacks = game.stacks;

  if (stacks.length < 2) {
    return { left: null, right: null };
  }

  return {
    left: stacks[(stackIndex - 1 + stacks.length) % stacks.length],
    right: stacks[(stackIndex + 1) % stacks.length]
  };
}

function calculateDifference(stackIndex) {
  const current = game.stacks[stackIndex];
  const neighbors = getNeighbors(stackIndex);

  if (!current || !neighbors.left || !neighbors.right) {
    return 0;
  }

  return Math.abs(current.height - neighbors.left.height) +
    Math.abs(current.height - neighbors.right.height);
}

function canCreateStack(index, color) {
  if (game.stacks.length < 2) {
    return true;
  }

  const neighbors = getNeighbors(index);

  if (!neighbors.left || !neighbors.right) {
    return true;
  }

  return (
    neighbors.left.color !== color &&
    neighbors.right.color !== color
  );
}

async function playPawn(color) {
  if (!playerCanPlay()) {
    setMessage("turnInstruction", "Ce n'est pas ton tour.");
    return;
  }

  const currentPlayer = getCurrentPlayer();

  if (currentPlayer.pawnsRemaining <= 0) {
    setMessage("turnInstruction", "Tu n'as plus de pions de cette couleur.");
    return;
  }

  if (selectedAction === "reinforce") {
    await reinforceStack(color);
  } else {
    await createStack(color);
  }
}

async function createStack(color) {
  const index = getNextAvailablePosition();

  if (!canCreateStack(index, color)) {
    setMessage(
      "turnInstruction",
      "Impossible de créer un tas ici : les deux voisins ont cette couleur."
    );
    return;
  }

  const current = getCurrentPlayer();

  const stack = {
    id: crypto.randomUUID(),
    color,
    ownerId: current.id,
    height: 1,
    position: index
  };

  game.stacks.push(stack);
  current.pawnsRemaining--;

  game.lastPlacedStackId = stack.id;
  game.lastDifference = calculateDifference(
    game.stacks.length - 1
  );

  await finishTurnPreparation();
}

async function reinforceStack(stack) {
  if (!playerCanPlay()) return;

  const current = getCurrentPlayer();

  if (stack.ownerId !== current.id && stack.color !== current.color) {
    setMessage(
      "turnInstruction",
      "Tu peux seulement renforcer un tas de ta couleur."
    );
    return;
  }

  if (stack.color !== current.color) {
    setMessage(
      "turnInstruction",
      "Ce tas n'est pas de ta couleur."
    );
    return;
  }

  stack.height++;
  current.pawnsRemaining--;

  const index = game.stacks.findIndex(item => item.id === stack.id);

  game.lastPlacedStackId = stack.id;
  game.lastDifference = calculateDifference(index);

  await finishTurnPreparation();
}

async function finishTurnPreparation() {
  selectedAction = null;
  selectedStackId = null;

  await saveGame();

  if (game.lastDifference >= 3) {
    setMessage(
      "turnInstruction",
      `Écart de ${game.lastDifference}. Tu peux effectuer un subterfuge.`
    );
    render();
    return;
  }

  await nextTurn();
}

async function nextTurn() {
  game.currentPlayerIndex =
    (game.currentPlayerIndex + 1) % game.players.length;

  game.turnSubterfugeUsed = false;
  game.lastPlacedStackId = null;
  game.lastDifference = 0;

  if (game.players.every(player => player.pawnsRemaining <= 0)) {
    finishGame();
    return;
  }

  await saveGame();
}

function getStackById(id) {
  return game.stacks.find(stack => stack.id === id);
}

async function useSacrifice() {
  if (!playerCanPlay() || game.turnSubterfugeUsed) return;

  const player = getCurrentPlayer();
  player.sacrifices++;

  game.turnSubterfugeUsed = true;

  await saveGame();
  await nextTurn();
}

async function useSwap() {
  if (!playerCanPlay() || game.turnSubterfugeUsed) return;

  const current = getCurrentPlayer();

  if (!selectedStackId) {
    selectedAction = "swap";
    setMessage(
      "turnInstruction",
      "Sélectionne ton premier tas à échanger."
    );
    return;
  }

  const first = getStackById(selectedStackId);

  if (!first || first.ownerId !== current.id) {
    setMessage(
      "turnInstruction",
      "Tu dois sélectionner un de tes tas."
    );
    return;
  }

  if (!selectedColor) {
    selectedColor = first.id;
    selectedStackId = null;
    setMessage(
      "turnInstruction",
      "Sélectionne ton second tas à échanger."
    );
    return;
  }

  const second = getStackById(selectedStackId);

  if (!second || second.ownerId !== current.id) {
    setMessage(
      "turnInstruction",
      "Le second tas doit aussi t'appartenir."
    );
    return;
  }

  const firstIndex = game.stacks.indexOf(first);
  const secondIndex = game.stacks.indexOf(second);

  [game.stacks[firstIndex], game.stacks[secondIndex]] =
    [game.stacks[secondIndex], game.stacks[firstIndex]];

  game.turnSubterfugeUsed = true;
  selectedAction = null;
  selectedColor = null;
  selectedStackId = null;

  await saveGame();
  await nextTurn();
}

async function useNeutralPawns() {
  if (!playerCanPlay() || game.turnSubterfugeUsed) return;

  if (game.neutralPawnsRemaining <= 0) {
    setMessage(
      "turnInstruction",
      "Il ne reste plus de pions neutres."
    );
    return;
  }

  selectedAction = "neutral";
  selectedStackId = null;

  setMessage(
    "turnInstruction",
    "Clique sur deux emplacements pour placer des pions neutres."
  );
}

async function placeNeutral() {
  if (selectedAction !== "neutral") return;

  const index = getNextAvailablePosition();

  if (!canCreateStack(index, "neutral")) {
    setMessage(
      "turnInstruction",
      "Placement neutre impossible à cet endroit."
    );
    return;
  }

  game.stacks.push({
    id: crypto.randomUUID(),
    color: "neutral",
    ownerId: null,
    height: 1,
    position: index
  });

  game.neutralPawnsRemaining--;
  selectedStackId = null;

  const neutralPlaced = game.stacks.filter(
    stack => stack.color === "neutral" &&
      stack.position >= game.stacks.length - 2
  ).length;

  if (neutralPlaced >= 2 || game.neutralPawnsRemaining <= 0) {
    game.turnSubterfugeUsed = true;
    selectedAction = null;
    await saveGame();
    await nextTurn();
  } else {
    await saveGame();
  }
}

function render() {
  if (!game) return;

  if (game.status === "waiting") {
    openLobby();
    return;
  }

  if (game.status === "finished") {
    renderEnd();
    return;
  }

  showScreen("gameScreen");
  renderPlayers();
  renderBoard();
  renderGameInfo();
}

function renderPlayers() {
  const panel = $("playersPanel");
  panel.innerHTML = "";

  const current = getCurrentPlayer();

  getAllPlayers().forEach(player => {
    const div = document.createElement("div");
    div.className = "player-card";

    if (current && current.id === player.id) {
      div.classList.add("active");
    }

    div.style.borderLeftColor = PLAYER_COLORS[player.color];

    div.innerHTML = `
      <strong>${escapeHtml(player.name)}</strong>
      <span>Couleur : ${player.color}</span><br>
      <span>Pions : ${player.pawnsRemaining}</span><br>
      <span>Sacrifices : ${player.sacrifices}</span>
    `;

    panel.appendChild(div);
  });
}

function renderBoard() {
  const layer = $("stackLayer");
  layer.innerHTML = "";

  const total = Math.max(game.stacks.length, 1);

  game.stacks.forEach((stack, index) => {
    const coordinates = positionToCoordinates(index, total);

    const element = document.createElement("div");
    element.className = `stack color-${stack.color}`;

    if (selectedStackId === stack.id) {
      element.classList.add("selected");
    }

    element.style.left = `${coordinates.left}%`;
    element.style.top = `${coordinates.top}%`;

    element.innerHTML = `
      <span class="stack-height">${stack.height}</span>
      <span class="stack-owner">
        ${stack.ownerId ? getPlayerName(stack.ownerId) : ""}
      </span>
    `;

    element.addEventListener("click", () => handleStackClick(stack));
    layer.appendChild(element);
  });
}

function handleStackClick(stack) {
  if (!playerCanPlay()) return;

  if (selectedAction === "swap") {
    selectedStackId = stack.id;
    render();
    return;
  }

  if (selectedAction === "neutral") {
    return;
  }

  selectedStackId = stack.id;
  selectedAction = "reinforce";
  render();

  setMessage(
    "turnInstruction",
    `Tas sélectionné. Clique à nouveau dessus pour le renforcer.`
  );

  setTimeout(() => {
    if (selectedAction === "reinforce" && selectedStackId === stack.id) {
      reinforceStack(stack);
    }
  }, 500);
}

function handleBoardClick() {
  if (selectedAction === "neutral") {
    placeNeutral();
    return;
  }

  if (!selectedAction) {
    const current = getCurrentPlayer();
    playPawn(current.color);
  }
}

function renderGameInfo() {
  const current = getCurrentPlayer();

  $("currentPlayerLabel").textContent =
    current ? current.name : "-";

  $("neutralCountLabel").textContent =
    game.neutralPawnsRemaining;

  $("differenceLabel").textContent =
    game.lastDifference
      ? `Dernier écart : ${game.lastDifference}`
      : "";

  const isMyTurn = playerCanPlay();

  $("sacrificeButton").disabled =
    !isMyTurn || game.turnSubterfugeUsed;

  $("swapButton").disabled =
    !isMyTurn || game.turnSubterfugeUsed;

  $("neutralButton").disabled =
    !isMyTurn ||
    game.turnSubterfugeUsed ||
    game.neutralPawnsRemaining <= 0;

  if (game.lastDifference >= 3 && isMyTurn) {
    $("turnInstruction").textContent =
      "Tu peux effectuer un subterfuge ou passer ton tour.";
  } else if (!isMyTurn) {
    $("turnInstruction").textContent =
      "Attends le tour du joueur suivant.";
  }
}

function calculateScores() {
  const scores = {};

  getAllPlayers().forEach(player => {
    scores[player.id] = 0;
  });

  game.stacks.forEach((stack, index) => {
    const neighbors = getNeighbors(index);

    if (!neighbors.left || !neighbors.right) return;

    let value = stack.height;

    if (
      neighbors.left.color === neighbors.right.color &&
      neighbors.left.color === stack.color
    ) {
      value = neighbors.left.height + neighbors.right.height;
    }

    if (value > neighbors.left.height) {
      if (stack.ownerId) scores[stack.ownerId]++;
    }

    if (value > neighbors.right.height) {
      if (stack.ownerId) scores[stack.ownerId]++;
    }
  });

  return scores;
}

function finishGame() {
  const scores = calculateScores();

  getAllPlayers().forEach(player => {
    player.score = scores[player.id] || 0;
  });

  const winners = getAllPlayers()
    .filter(player => !player.isGhost)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.sacrifices !== a.sacrifices) {
        return b.sacrifices - a.sacrifices;
      }

      const aStacks = game.stacks.filter(
        stack => stack.ownerId === a.id
      ).length;

      const bStacks = game.stacks.filter(
        stack => stack.ownerId === b.id
      ).length;

      return bStacks - aStacks;
    });

  game.winnerId = winners[0]?.id || null;
  game.status = "finished";
  saveGame();
}

function renderEnd() {
  showScreen("endScreen");

  const winner = getAllPlayers()
    .find(player => player.id === game.winnerId);

  $("winnerLabel").textContent =
    winner ? `Victoire de ${winner.name} !` : "Égalité";

  const scores = [...getAllPlayers()]
    .filter(player => !player.isGhost)
    .sort((a, b) => b.score - a.score);

  $("finalScores").innerHTML = scores.map(player => `
    <div class="score-row">
      <span>${escapeHtml(player.name)}</span>
      <strong>${player.score} PV</strong>
    </div>
  `).join("");
}

function getPlayerName(id) {
  const player = getAllPlayers().find(item => item.id === id);
  return player ? player.name : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("createGameButton").addEventListener("click", createGame);
$("joinGameButton").addEventListener("click", joinGame);

$("startGameButton").addEventListener("click", startGame);

$("copyCodeButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText(game.code);
  setMessage("lobbyMessage", "Code copié.");
});

$("sacrificeButton").addEventListener("click", useSacrifice);
$("swapButton").addEventListener("click", useSwap);
$("neutralButton").addEventListener("click", useNeutralPawns);

$("cancelActionButton").addEventListener("click", () => {
  selectedAction = null;
  selectedStackId = null;
  selectedColor = null;
  render();
});

$("board").addEventListener("click", event => {
  if (event.target.classList.contains("stack")) return;
  handleBoardClick();
});

$("restartButton").addEventListener("click", () => {
  game = null;
  gameCode = null;
  showScreen("homeScreen");
});

setMessage(
  "homeMessage",
  "Configure Supabase avant de commencer une partie."
);
