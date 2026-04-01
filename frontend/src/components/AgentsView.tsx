import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent } from "../types";

interface Props {
  agents: Agent[];
  onCreateAgent: () => void;
  onEditAgent: (agent: Agent) => void;
  onDeleteAgent: (id: string) => void;
  onRefreshAgents: () => void;
}

const FONT = "'JetBrains Mono', monospace";
const TILE = 20;
const WALL_T = 10;
const PX = 2;
const SPRITE_W = 8;
const SPRITE_H = 10;
const TICK_INTERVAL = 3; // tick NPCs every N frames

// Colors
const C_BG = "#0A0A0A";
const C_BORDER = "#2a2a2a";
const C_TEXT = "#FAFAFA";
const C_DIM = "#6B7280";
const C_DIMMER = "#4B5563";
const C_ACCENT = "#10B981";
const C_FLOOR_A = "#2A2218";
const C_FLOOR_B = "#2E2519";
const C_WALL = "#3D3428";
const C_WALL_TRIM = "#4A3F32";
const C_DESK_TOP = "#3D3428";
const C_DESK_SIDE = "#2A2218";
const C_COUCH_FRAME = "#5C4033";
const C_COUCH_CUSHION = "#6B4C3A";
const C_FRIDGE = "#D1D5DB";
const C_WHITEBOARD = "#E5E7EB";
const C_COFFEE_TABLE = "#4A3F32";
const C_SERVER = "#1A1A1A";
const C_PLANT_LEAF = "#22C55E";
const C_PLANT_POT = "#6B3A2A";
const C_RUG_A = "#5C3030";
const C_RUG_B = "#6B3A3A";
const C_KITCHEN_COUNTER = "#3D3428";

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------
function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Direction = "down" | "up" | "left" | "right";
type NpcState = "idle" | "walking" | "working" | "socializing";

interface Rect { tx: number; ty: number; tw: number; th: number }
interface FurnitureItem extends Rect { kind: string; color?: string }

interface Npc {
  agent: Agent;
  tx: number;
  ty: number;
  targetTx: number;
  targetTy: number;
  dir: Direction;
  state: NpcState;
  stateTimer: number;
  walkFrame: number;
  deskIdx: number;
  speed: number;
  sociability: number;
  restless: number;
  phrases: string[];
  bubbleText: string;
  bubbleTimer: number;
  bubbleCooldown: number;
  workBob: number;
}

interface OfficeLayout {
  gridW: number;
  gridH: number;
  occupied: boolean[][];
  furniture: FurnitureItem[];
  desks: Rect[];
  loungeCenter: { tx: number; ty: number };
  kitchenCenter: { tx: number; ty: number };
}

// ---------------------------------------------------------------------------
// Phrase generation from role/goal
// ---------------------------------------------------------------------------
function generatePhrases(agent: Agent): string[] {
  const text = `${agent.role} ${agent.goal}`.toLowerCase();
  const phrases: string[] = [];
  if (text.includes("review")) phrases.push("reviewing...", "looks clean", "hmm...");
  if (text.includes("implement")) phrases.push("coding...", "almost done", "which repo?");
  if (text.includes("fix")) phrases.push("found it!", "fixing...", "one more test");
  if (text.includes("validate") || text.includes("qa")) phrases.push("testing...", "all green", "found a bug");
  if (text.includes("commit") || text.includes("pr")) phrases.push("pushing...", "CI running", "PR ready");
  if (text.includes("format") || text.includes("comment") || text.includes("message")) phrases.push("posting...", "formatted!", "done");
  if (text.includes("move") || text.includes("status")) phrases.push("moving...", "updated!", "done");
  if (text.includes("deal") || text.includes("bike") || text.includes("scan")) phrases.push("checking...", "nice price!", "sold :(");
  if (phrases.length === 0) phrases.push("...", "thinking", "hmm");
  return phrases;
}

// ---------------------------------------------------------------------------
// Office layout generation
// ---------------------------------------------------------------------------
function buildOfficeLayout(canvasW: number, canvasH: number, agents: Agent[]): OfficeLayout {
  const headerH = 0; // header is outside canvas
  const gridW = Math.floor(canvasW / TILE);
  const gridH = Math.floor(canvasH / TILE);
  const occupied: boolean[][] = Array.from({ length: gridH }, () => Array(gridW).fill(false));
  const furniture: FurnitureItem[] = [];
  const desks: Rect[] = [];

  // Mark walls as occupied (outer half-tile border)
  const wallTiles = Math.ceil(WALL_T / TILE);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      if (x < wallTiles || y < wallTiles || x >= gridW - wallTiles || y >= gridH - wallTiles) {
        occupied[y][x] = true;
      }
    }
  }

  function canPlace(tx: number, ty: number, tw: number, th: number): boolean {
    for (let dy = 0; dy < th; dy++) {
      for (let dx = 0; dx < tw; dx++) {
        const ny = ty + dy, nx = tx + dx;
        if (ny < 0 || ny >= gridH || nx < 0 || nx >= gridW || occupied[ny][nx]) return false;
      }
    }
    return true;
  }

  function place(tx: number, ty: number, tw: number, th: number, kind: string, color?: string) {
    for (let dy = 0; dy < th; dy++) {
      for (let dx = 0; dx < tw; dx++) {
        if (ty + dy < gridH && tx + dx < gridW) occupied[ty + dy][tx + dx] = true;
      }
    }
    furniture.push({ tx, ty, tw, th, kind, color });
  }

  const innerLeft = wallTiles;
  const innerTop = wallTiles;
  const innerRight = gridW - wallTiles;
  const innerBottom = gridH - wallTiles;
  const midX = Math.floor((innerLeft + innerRight) / 2);
  const midY = Math.floor((innerTop + innerBottom) / 2);

  // --- Desk Zone (top-left quadrant) ---
  const deskStartX = innerLeft + 1;
  const deskStartY = innerTop + 1;
  const desksPerRow = Math.min(4, Math.floor((midX - deskStartX - 1) / 4));
  const maxDesks = Math.min(agents.length, 12);
  for (let i = 0; i < maxDesks; i++) {
    const row = Math.floor(i / desksPerRow);
    const col = i % desksPerRow;
    const dtx = deskStartX + col * 4;
    const dty = deskStartY + row * 3;
    if (dtx + 3 <= midX && dty + 2 <= midY && canPlace(dtx, dty, 3, 2)) {
      place(dtx, dty, 3, 2, "desk", agents[i]?.color);
      desks.push({ tx: dtx, ty: dty, tw: 3, th: 2 });
    }
  }

  // --- Meeting Zone (top-right quadrant) ---
  const meetX = midX + 2;
  const meetY = innerTop + 2;
  // Whiteboard
  if (meetX + 4 < innerRight && meetY + 1 < midY) {
    place(meetX, innerTop, 4, 1, "whiteboard");
  }
  // Round table
  if (canPlace(meetX + 1, meetY + 1, 2, 2)) {
    place(meetX + 1, meetY + 1, 2, 2, "meeting_table");
  }

  // --- Lounge Zone (bottom-left quadrant) ---
  const loungeX = innerLeft + 1;
  const loungeY = midY + 2;
  // Rug
  if (loungeX + 4 < midX && loungeY + 3 < innerBottom) {
    furniture.push({ tx: loungeX, ty: loungeY, tw: 4, th: 3, kind: "rug" }); // don't mark occupied
  }
  // Couch
  if (canPlace(loungeX, loungeY + 3, 3, 1)) {
    place(loungeX, loungeY + 3, 3, 1, "couch");
  }
  // Coffee table
  if (canPlace(loungeX + 1, loungeY + 1, 2, 1)) {
    place(loungeX + 1, loungeY + 1, 2, 1, "coffee_table");
  }
  // Plant
  if (canPlace(loungeX + 4, loungeY, 1, 1)) {
    place(loungeX + 4, loungeY, 1, 1, "plant");
  }

  // --- Kitchen Zone (bottom-right quadrant) ---
  const kitchenX = midX + 2;
  const kitchenY = midY + 2;
  // Counter
  if (kitchenX + 3 < innerRight && kitchenY + 1 < innerBottom) {
    if (canPlace(kitchenX, kitchenY, 3, 1)) {
      place(kitchenX, kitchenY, 3, 1, "counter");
    }
  }
  // Fridge
  if (canPlace(kitchenX + 4, kitchenY, 1, 2)) {
    place(kitchenX + 4, kitchenY, 1, 2, "fridge");
  }
  // Coffee machine
  if (canPlace(kitchenX, kitchenY + 2, 1, 1)) {
    place(kitchenX, kitchenY + 2, 1, 1, "coffee_machine");
  }

  // --- Server Area (right wall) ---
  const serverX = innerRight - 2;
  const serverY = midY - 2;
  for (let i = 0; i < Math.min(agents.filter(a => Object.values(a.mcpServers).some(v => v)).length, 3); i++) {
    if (canPlace(serverX, serverY + i * 2, 1, 2)) {
      place(serverX, serverY + i * 2, 1, 2, "server_rack");
    }
  }

  // --- Kanban Board (on top wall, right side) ---
  if (innerRight - 6 > midX) {
    furniture.push({ tx: innerRight - 6, ty: 0, tw: 5, th: 1, kind: "kanban" });
  }

  // --- Wall Decorations ---
  const rng = makeRng(agents.length * 7 + 42);
  const posterCount = Math.min(agents.length, 3);
  for (let i = 0; i < posterCount; i++) {
    const px = innerLeft + 2 + Math.floor(rng() * Math.max(1, (midX - innerLeft - 4)));
    furniture.push({ tx: px, ty: 0, tw: 2, th: 1, kind: "poster", color: agents[i]?.color });
  }

  return {
    gridW,
    gridH,
    occupied,
    furniture,
    desks,
    loungeCenter: { tx: loungeX + 2, ty: loungeY + 1 },
    kitchenCenter: { tx: kitchenX + 1, ty: kitchenY + 1 },
  };
}

// ---------------------------------------------------------------------------
// NPC creation
// ---------------------------------------------------------------------------
function createNpc(agent: Agent, index: number, layout: OfficeLayout): Npc {
  const enabledSkills = Object.values(agent.skills).filter(Boolean).length;
  const enabledMcp = Object.values(agent.mcpServers).filter(Boolean).length;
  const speed = 0.3 + (enabledSkills / 60) * 0.5;
  const sociability = Math.min(enabledMcp / 3, 1.0);
  const restless = agent.autonomousMode ? 0.7 : 0.3;

  // Start near their desk or in a corridor
  let startTx = layout.gridW > 4 ? 3 + (index % Math.max(1, layout.gridW - 6)) : 3;
  let startTy = layout.gridH > 4 ? 3 + Math.floor(index / Math.max(1, layout.gridW - 6)) * 2 : 3;
  // Clamp
  startTx = Math.min(startTx, layout.gridW - 2);
  startTy = Math.min(startTy, layout.gridH - 2);
  // If on occupied tile, nudge
  while (startTy < layout.gridH - 1 && layout.occupied[startTy] && layout.occupied[startTy][startTx]) {
    startTy++;
  }

  return {
    agent,
    tx: startTx,
    ty: startTy,
    targetTx: startTx,
    targetTy: startTy,
    dir: "down",
    state: "idle",
    stateTimer: 30 + Math.floor(Math.random() * 60),
    walkFrame: 0,
    deskIdx: index < layout.desks.length ? index : -1,
    speed,
    sociability,
    restless,
    phrases: generatePhrases(agent),
    bubbleText: "",
    bubbleTimer: 0,
    bubbleCooldown: 200 + Math.floor(Math.random() * 200),
    workBob: 0,
  };
}

// ---------------------------------------------------------------------------
// NPC state machine tick
// ---------------------------------------------------------------------------
function tickNpc(npc: Npc, npcs: Npc[], layout: OfficeLayout) {
  // Bubble
  if (npc.bubbleTimer > 0) {
    npc.bubbleTimer--;
  } else if (npc.bubbleCooldown > 0) {
    npc.bubbleCooldown--;
  } else {
    npc.bubbleText = npc.phrases[Math.floor(Math.random() * npc.phrases.length)];
    npc.bubbleTimer = 80;
    npc.bubbleCooldown = 200 + Math.floor(Math.random() * 200);
  }

  switch (npc.state) {
    case "idle": {
      npc.stateTimer--;
      if (npc.stateTimer <= 0) {
        const roll = Math.random();
        const walkChance = npc.restless > 0.5 ? 0.6 : 0.4;
        const workChance = walkChance + 0.3;
        const socChance = workChance + (npc.sociability > 0.5 ? 0.4 : 0.2);

        if (roll < walkChance) {
          // Walk to random open tile
          const tx = 2 + Math.floor(Math.random() * Math.max(1, layout.gridW - 4));
          const ty = 2 + Math.floor(Math.random() * Math.max(1, layout.gridH - 4));
          npc.targetTx = tx;
          npc.targetTy = ty;
          npc.state = "walking";
          npc.stateTimer = 300;
        } else if (roll < workChance && npc.deskIdx >= 0 && npc.deskIdx < layout.desks.length) {
          // Walk to desk
          const desk = layout.desks[npc.deskIdx];
          npc.targetTx = desk.tx + 1;
          npc.targetTy = desk.ty + 2; // sit in front of desk
          if (npc.targetTy >= layout.gridH - 1) npc.targetTy = desk.ty - 1;
          npc.state = "walking";
          npc.stateTimer = 300;
        } else if (roll < socChance) {
          // Walk toward nearest NPC
          let nearest: Npc | null = null;
          let minDist = Infinity;
          for (const other of npcs) {
            if (other === npc) continue;
            const d = Math.abs(other.tx - npc.tx) + Math.abs(other.ty - npc.ty);
            if (d < minDist) { minDist = d; nearest = other; }
          }
          if (nearest) {
            npc.targetTx = nearest.tx + (nearest.tx > npc.tx ? -1 : 1);
            npc.targetTy = nearest.ty;
            npc.state = "walking";
            npc.stateTimer = 300;
          } else {
            npc.stateTimer = 20 + Math.floor(Math.random() * 40);
          }
        } else {
          // Walk to lounge/kitchen
          const target = Math.random() > 0.5 ? layout.loungeCenter : layout.kitchenCenter;
          npc.targetTx = target.tx;
          npc.targetTy = target.ty;
          npc.state = "walking";
          npc.stateTimer = 300;
        }
      }
      break;
    }
    case "walking": {
      npc.stateTimer--;
      if (npc.stateTimer <= 0 || (npc.tx === npc.targetTx && npc.ty === npc.targetTy)) {
        // Arrived or timed out
        // Check if at desk → working, near another NPC → socializing, else idle
        if (npc.deskIdx >= 0 && npc.deskIdx < layout.desks.length) {
          const desk = layout.desks[npc.deskIdx];
          if (Math.abs(npc.tx - desk.tx - 1) <= 1 && Math.abs(npc.ty - desk.ty - 2) <= 1) {
            npc.state = "working";
            npc.dir = "up";
            npc.stateTimer = 100 + Math.floor(Math.random() * 100);
            break;
          }
        }
        // Check if near another NPC
        for (const other of npcs) {
          if (other === npc) continue;
          if (Math.abs(other.tx - npc.tx) + Math.abs(other.ty - npc.ty) <= 2) {
            npc.state = "socializing";
            // Face them
            if (other.tx > npc.tx) npc.dir = "right";
            else if (other.tx < npc.tx) npc.dir = "left";
            else if (other.ty > npc.ty) npc.dir = "down";
            else npc.dir = "up";
            npc.stateTimer = 60 + Math.floor(Math.random() * 40);
            break;
          }
        }
        if (npc.state === "walking") {
          npc.state = "idle";
          npc.stateTimer = 15 + Math.floor(Math.random() * 30);
        }
        break;
      }

      // Move one tile toward target (greedy)
      const dx = npc.targetTx - npc.tx;
      const dy = npc.targetTy - npc.ty;
      let nextTx = npc.tx;
      let nextTy = npc.ty;

      // Prefer horizontal
      if (dx !== 0) {
        nextTx = npc.tx + (dx > 0 ? 1 : -1);
        npc.dir = dx > 0 ? "right" : "left";
      } else if (dy !== 0) {
        nextTy = npc.ty + (dy > 0 ? 1 : -1);
        npc.dir = dy > 0 ? "down" : "up";
      }

      // Collision check (walls + furniture, NPCs can overlap)
      if (nextTx >= 1 && nextTx < layout.gridW - 1 && nextTy >= 1 && nextTy < layout.gridH - 1 &&
          !layout.occupied[nextTy][nextTx]) {
        npc.tx = nextTx;
        npc.ty = nextTy;
      } else {
        // Try perpendicular
        if (dy !== 0 && dx === 0) {
          const tryX = npc.tx + (Math.random() > 0.5 ? 1 : -1);
          if (tryX >= 1 && tryX < layout.gridW - 1 && !layout.occupied[npc.ty][tryX]) {
            npc.tx = tryX;
            npc.dir = tryX > npc.tx ? "right" : "left";
          }
        } else if (dx !== 0 && dy === 0) {
          const tryY = npc.ty + (Math.random() > 0.5 ? 1 : -1);
          if (tryY >= 1 && tryY < layout.gridH - 1 && !layout.occupied[tryY][npc.tx]) {
            npc.ty = tryY;
            npc.dir = tryY > npc.ty ? "down" : "up";
          }
        } else {
          // Give up on this step
          npc.stateTimer = Math.min(npc.stateTimer, 5);
        }
      }

      npc.walkFrame = (npc.walkFrame + 1) % 4;
      break;
    }
    case "working": {
      npc.stateTimer--;
      npc.workBob = (npc.workBob + 1) % 20;
      if (npc.stateTimer <= 0) {
        npc.state = "idle";
        npc.stateTimer = 20 + Math.floor(Math.random() * 40);
      }
      break;
    }
    case "socializing": {
      npc.stateTimer--;
      if (npc.stateTimer <= 0) {
        npc.state = "idle";
        npc.stateTimer = 20 + Math.floor(Math.random() * 40);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
function drawFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  for (let y = 0; y < h; y += TILE) {
    for (let x = 0; x < w; x += TILE) {
      const tileX = Math.floor(x / TILE);
      const tileY = Math.floor(y / TILE);
      ctx.fillStyle = (tileX + tileY) % 2 === 0 ? C_FLOOR_A : C_FLOOR_B;
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = C_WALL;
  // Top wall
  ctx.fillRect(0, 0, w, WALL_T);
  // Bottom wall
  ctx.fillRect(0, h - WALL_T, w, WALL_T);
  // Left wall
  ctx.fillRect(0, 0, WALL_T, h);
  // Right wall
  ctx.fillRect(w - WALL_T, 0, WALL_T, h);

  // Inner trim
  ctx.fillStyle = C_WALL_TRIM;
  ctx.fillRect(WALL_T, WALL_T, w - WALL_T * 2, 2);
  ctx.fillRect(WALL_T, h - WALL_T - 2, w - WALL_T * 2, 2);
  ctx.fillRect(WALL_T, WALL_T, 2, h - WALL_T * 2);
  ctx.fillRect(w - WALL_T - 2, WALL_T, 2, h - WALL_T * 2);
}

function drawFurniture(ctx: CanvasRenderingContext2D, item: FurnitureItem, agents: Agent[]) {
  const x = item.tx * TILE;
  const y = item.ty * TILE;
  const w = item.tw * TILE;
  const h = item.th * TILE;

  switch (item.kind) {
    case "desk": {
      // Desk body
      ctx.fillStyle = C_DESK_SIDE;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C_DESK_TOP;
      ctx.fillRect(x + 1, y + 1, w - 2, h / 2);
      // Monitor
      ctx.fillStyle = "#111";
      ctx.fillRect(x + w / 2 - 6, y + 3, 12, 8);
      // Screen line in agent color
      if (item.color) {
        ctx.fillStyle = item.color;
        ctx.fillRect(x + w / 2 - 4, y + 5, 8, 1);
        ctx.fillRect(x + w / 2 - 3, y + 7, 6, 1);
      }
      break;
    }
    case "whiteboard": {
      ctx.fillStyle = C_WHITEBOARD;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C_BORDER;
      ctx.strokeStyle = C_DIMMER;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // Colored dots
      for (let i = 0; i < Math.min(agents.length, 5); i++) {
        ctx.fillStyle = agents[i].color || C_ACCENT;
        ctx.fillRect(x + 4 + i * 8, y + h / 2 - 2, 4, 4);
      }
      break;
    }
    case "meeting_table": {
      ctx.fillStyle = C_DESK_TOP;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 * TILE / TILE * 0.9, 0, Math.PI * 2);
      ctx.fill();
      // Chairs
      ctx.fillStyle = C_COUCH_FRAME;
      ctx.fillRect(x - 4, y + h / 2 - 3, 4, 6);
      ctx.fillRect(x + w, y + h / 2 - 3, 4, 6);
      ctx.fillRect(x + w / 2 - 3, y - 4, 6, 4);
      ctx.fillRect(x + w / 2 - 3, y + h, 6, 4);
      break;
    }
    case "rug": {
      for (let ry = 0; ry < item.th; ry++) {
        for (let rx = 0; rx < item.tw; rx++) {
          ctx.fillStyle = (rx + ry) % 2 === 0 ? C_RUG_A : C_RUG_B;
          ctx.fillRect(x + rx * TILE, y + ry * TILE, TILE, TILE);
        }
      }
      // Border
      ctx.strokeStyle = C_RUG_B;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      break;
    }
    case "couch": {
      ctx.fillStyle = C_COUCH_FRAME;
      ctx.fillRect(x, y, w, h);
      // Cushions
      const cushionW = Math.floor(w / 3);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = C_COUCH_CUSHION;
        ctx.fillRect(x + i * cushionW + 2, y + 2, cushionW - 4, h - 4);
      }
      break;
    }
    case "coffee_table": {
      ctx.fillStyle = C_COFFEE_TABLE;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      // Legs
      ctx.fillStyle = C_DESK_SIDE;
      ctx.fillRect(x, y, 3, 3);
      ctx.fillRect(x + w - 3, y, 3, 3);
      ctx.fillRect(x, y + h - 3, 3, 3);
      ctx.fillRect(x + w - 3, y + h - 3, 3, 3);
      break;
    }
    case "plant": {
      // Pot
      ctx.fillStyle = C_PLANT_POT;
      ctx.fillRect(x + 4, y + h - 8, TILE - 8, 8);
      // Leaves
      ctx.fillStyle = C_PLANT_LEAF;
      ctx.fillRect(x + 2, y + 2, 6, 6);
      ctx.fillRect(x + 8, y, 6, 6);
      ctx.fillRect(x + 5, y + 6, 4, 4);
      break;
    }
    case "counter": {
      ctx.fillStyle = C_KITCHEN_COUNTER;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C_WALL_TRIM;
      ctx.fillRect(x + 1, y + 1, w - 2, 3);
      break;
    }
    case "fridge": {
      ctx.fillStyle = C_FRIDGE;
      ctx.fillRect(x, y, w, h);
      // Handle
      ctx.fillStyle = C_DIMMER;
      ctx.fillRect(x + w - 4, y + 6, 2, h - 12);
      // Line between doors
      ctx.fillStyle = "#B0B0B0";
      ctx.fillRect(x + 1, y + Math.floor(h * 0.4), w - 2, 1);
      break;
    }
    case "coffee_machine": {
      ctx.fillStyle = "#333";
      ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      // Red LED
      ctx.fillStyle = "#EF4444";
      ctx.fillRect(x + TILE - 6, y + 5, 2, 2);
      break;
    }
    case "server_rack": {
      ctx.fillStyle = C_SERVER;
      ctx.fillRect(x, y, w, h);
      // Blinking LEDs (use time-based approach in render, but static here)
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#22C55E" : "#3B82F6";
        ctx.fillRect(x + 3, y + 4 + i * 8, 3, 2);
      }
      ctx.fillStyle = "#222";
      ctx.fillRect(x + 1, y + 1, w - 2, 2);
      break;
    }
    case "kanban": {
      ctx.fillStyle = "#1F1F1F";
      ctx.fillRect(x, y, w, h);
      // Columns
      const colW = Math.floor(w / 3);
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = "#333";
        ctx.fillRect(x + c * colW, y, 1, h);
        // Cards
        const cardColors = ["#EF4444", "#3B82F6", C_ACCENT, "#F59E0B"];
        for (let r = 0; r < 2; r++) {
          ctx.fillStyle = cardColors[(c + r) % cardColors.length];
          ctx.fillRect(x + c * colW + 3, y + 3 + r * 6, colW - 6, 4);
        }
      }
      break;
    }
    case "poster": {
      ctx.fillStyle = item.color || "#3B82F6";
      ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
      ctx.strokeStyle = C_WALL_TRIM;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2.5, y + 1.5, w - 5, h - 3);
      break;
    }
  }
}

function drawSprite(ctx: CanvasRenderingContext2D, npc: Npc, tick: number) {
  const px = npc.tx * TILE + (TILE - SPRITE_W * PX) / 2;
  let py = npc.ty * TILE + (TILE - SPRITE_H * PX) / 2;

  // Work bobbing
  if (npc.state === "working") {
    py += npc.workBob < 10 ? -1 : 1;
  }

  const color = npc.agent.color || C_ACCENT;
  const frame = npc.state === "walking" ? npc.walkFrame : 0;
  const isWalkA = frame < 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(px + PX, py + SPRITE_H * PX - PX, SPRITE_W * PX - PX * 2, PX);

  // Helper to draw a pixel
  const dot = (gx: number, gy: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(px + gx * PX, py + gy * PX, PX, PX);
  };

  // --- Head (rows 0-3) ---
  const skinColor = "#F5D0A9";
  const hairColor = darkenColor(color, 0.4);

  // Hair top (row 0)
  for (let i = 2; i <= 5; i++) dot(i, 0, hairColor);

  // Head rows 1-3
  if (npc.dir === "down") {
    // row 1: hair sides, skin middle
    dot(1, 1, hairColor); dot(2, 1, skinColor); dot(3, 1, skinColor);
    dot(4, 1, skinColor); dot(5, 1, skinColor); dot(6, 1, hairColor);
    // row 2: eyes
    dot(1, 2, hairColor); dot(2, 2, skinColor); dot(3, 2, "#333"); // left eye
    dot(4, 2, skinColor); dot(5, 2, "#333"); // right eye
    dot(6, 2, skinColor);
    // row 3: mouth area
    dot(2, 3, skinColor); dot(3, 3, skinColor); dot(4, 3, skinColor); dot(5, 3, skinColor);
  } else if (npc.dir === "up") {
    dot(1, 1, hairColor); dot(2, 1, hairColor); dot(3, 1, hairColor);
    dot(4, 1, hairColor); dot(5, 1, hairColor); dot(6, 1, hairColor);
    dot(1, 2, hairColor); dot(2, 2, hairColor); dot(3, 2, hairColor);
    dot(4, 2, hairColor); dot(5, 2, hairColor); dot(6, 2, hairColor);
    dot(2, 3, skinColor); dot(3, 3, skinColor); dot(4, 3, skinColor); dot(5, 3, skinColor);
  } else if (npc.dir === "left") {
    dot(1, 1, hairColor); dot(2, 1, hairColor); dot(3, 1, skinColor);
    dot(4, 1, skinColor); dot(5, 1, skinColor);
    dot(1, 2, hairColor); dot(2, 2, "#333"); dot(3, 2, skinColor);
    dot(4, 2, skinColor); dot(5, 2, skinColor);
    dot(2, 3, skinColor); dot(3, 3, skinColor); dot(4, 3, skinColor); dot(5, 3, skinColor);
  } else {
    // right
    dot(3, 1, skinColor); dot(4, 1, skinColor); dot(5, 1, skinColor);
    dot(6, 1, hairColor); dot(7, 1, hairColor);
    dot(3, 2, skinColor); dot(4, 2, skinColor); dot(5, 2, "#333");
    dot(6, 2, hairColor); dot(7, 2, hairColor);
    dot(3, 3, skinColor); dot(4, 3, skinColor); dot(5, 3, skinColor); dot(6, 3, skinColor);
  }

  // --- Body (rows 4-7) ---
  const bodyColor = color;
  for (let row = 4; row <= 7; row++) {
    for (let col = 2; col <= 5; col++) {
      dot(col, row, bodyColor);
    }
    // Arms
    if (row >= 4 && row <= 6) {
      dot(1, row, bodyColor);
      dot(6, row, bodyColor);
    }
  }

  // --- Legs (rows 8-9) ---
  const legColor = darkenColor(color, 0.5);
  if (npc.state === "walking" && isWalkA) {
    dot(2, 8, legColor); dot(3, 8, legColor);
    dot(4, 9, legColor); dot(5, 9, legColor);
  } else if (npc.state === "walking" && !isWalkA) {
    dot(4, 8, legColor); dot(5, 8, legColor);
    dot(2, 9, legColor); dot(3, 9, legColor);
  } else {
    dot(2, 8, legColor); dot(3, 8, legColor);
    dot(4, 8, legColor); dot(5, 8, legColor);
    dot(2, 9, legColor); dot(3, 9, legColor);
    dot(4, 9, legColor); dot(5, 9, legColor);
  }
}

function drawBubble(ctx: CanvasRenderingContext2D, npc: Npc) {
  if (npc.bubbleTimer <= 0 || !npc.bubbleText) return;

  const px = npc.tx * TILE + TILE / 2;
  const py = npc.ty * TILE - 14;

  ctx.font = `9px ${FONT}`;
  const metrics = ctx.measureText(npc.bubbleText);
  const bw = metrics.width + 8;
  const bh = 14;
  const bx = px - bw / 2;
  const by = py - bh;

  // Fade out in last 20 ticks
  const alpha = npc.bubbleTimer < 20 ? npc.bubbleTimer / 20 : 1;
  ctx.globalAlpha = alpha;

  // Bubble background
  ctx.fillStyle = "#FAFAFA";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 3);
  ctx.fill();

  // Tail
  ctx.beginPath();
  ctx.moveTo(px - 3, by + bh);
  ctx.lineTo(px, by + bh + 4);
  ctx.lineTo(px + 3, by + bh);
  ctx.fill();

  // Text
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(npc.bubbleText, px, by + bh / 2);

  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawServerLeds(ctx: CanvasRenderingContext2D, layout: OfficeLayout, tick: number) {
  for (const item of layout.furniture) {
    if (item.kind !== "server_rack") continue;
    const x = item.tx * TILE;
    const y = item.ty * TILE;
    for (let i = 0; i < 4; i++) {
      const on = ((tick + i * 7) % 30) < 15;
      ctx.fillStyle = on ? (i % 2 === 0 ? "#22C55E" : "#3B82F6") : "#111";
      ctx.fillRect(x + 3, y + 4 + i * 8, 3, 2);
    }
  }
}

function darkenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - amount;
  return `rgb(${Math.floor(r * f)},${Math.floor(g * f)},${Math.floor(b * f)})`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AgentsView({ agents, onCreateAgent, onEditAgent, onDeleteAgent, onRefreshAgents }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const npcsRef = useRef<Npc[]>([]);
  const layoutRef = useRef<OfficeLayout | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const frameRef = useRef(0);
  const tickRef = useRef(0);
  const rafRef = useRef(0);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  // Build layout + NPCs when agents or canvas size changes
  const rebuildLayout = useCallback((w: number, h: number, agentList: Agent[]) => {
    if (w < 100 || h < 100) return;
    const layout = buildOfficeLayout(w, h, agentList);
    layoutRef.current = layout;

    // Rebuild NPCs, preserving positions if agent still exists
    const oldNpcs = npcsRef.current;
    const newNpcs = agentList.map((agent, i) => {
      const existing = oldNpcs.find(n => n.agent.id === agent.id);
      if (existing) {
        existing.agent = agent;
        existing.deskIdx = i < layout.desks.length ? i : -1;
        existing.phrases = generatePhrases(agent);
        return existing;
      }
      return createNpc(agent, i, layout);
    });
    npcsRef.current = newNpcs;
  }, []);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const w = Math.floor(width);
        const h = Math.floor(height);
        if (w !== sizeRef.current.w || h !== sizeRef.current.h) {
          sizeRef.current = { w, h };
          setCanvasSize({ w, h });
          rebuildLayout(w, h, agents);
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [agents, rebuildLayout]);

  // Rebuild when agents change
  useEffect(() => {
    rebuildLayout(sizeRef.current.w, sizeRef.current.h, agents);
  }, [agents, rebuildLayout]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    function render() {
      if (!running || !ctx) return;
      const { w, h } = sizeRef.current;
      const layout = layoutRef.current;
      const npcs = npcsRef.current;

      if (w > 0 && h > 0 && layout) {
        canvas!.width = w;
        canvas!.height = h;

        // Tick NPCs
        frameRef.current++;
        if (frameRef.current % TICK_INTERVAL === 0) {
          tickRef.current++;
          for (const npc of npcs) {
            tickNpc(npc, npcs, layout);
          }
        }

        // Clear
        ctx.fillStyle = C_BG;
        ctx.fillRect(0, 0, w, h);

        // Floor
        drawFloor(ctx, w, h);

        // Walls
        drawWalls(ctx, w, h);

        // Furniture (bottom layer: rugs first)
        for (const item of layout.furniture) {
          if (item.kind === "rug") drawFurniture(ctx, item, agents);
        }
        for (const item of layout.furniture) {
          if (item.kind !== "rug") drawFurniture(ctx, item, agents);
        }

        // Server LEDs (animated)
        drawServerLeds(ctx, layout, tickRef.current);

        // NPCs (sorted by y for depth)
        const sorted = [...npcs].sort((a, b) => a.ty - b.ty);
        for (const npc of sorted) {
          drawSprite(ctx, npc, tickRef.current);
        }

        // Speech bubbles (on top)
        for (const npc of sorted) {
          drawBubble(ctx, npc);
        }
      }

      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [agents, canvasSize]);

  // Click detection on canvas
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const npcs = npcsRef.current;
    for (const npc of npcs) {
      const nx = npc.tx * TILE + TILE / 2;
      const ny = npc.ty * TILE + TILE / 2;
      const dist = Math.sqrt((mx - nx) ** 2 + (my - ny) ** 2);
      if (dist < TILE * 1.2) {
        onEditAgent(npc.agent);
        return;
      }
    }
  }, [onEditAgent]);

  // Empty state
  if (agents.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C_BG, fontFamily: FONT }}>
        {/* Header */}
        <div style={{
          height: 56, minHeight: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", borderBottom: `1px solid ${C_BORDER}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: C_TEXT, fontSize: 14, fontWeight: 600 }}>agents</span>
            <span style={{ color: C_DIMMER, fontSize: 12 }}>0</span>
          </div>
          <button onClick={onCreateAgent} style={{
            background: "transparent", border: `1px solid ${C_ACCENT}`, color: C_ACCENT,
            fontFamily: FONT, fontSize: 12, padding: "6px 14px", borderRadius: 4, cursor: "pointer",
          }}>+ new agent</button>
        </div>
        {/* Empty */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <span style={{ color: C_DIMMER, fontSize: 13 }}>no agents yet</span>
          <button onClick={onCreateAgent} style={{
            background: "transparent", border: `1px solid ${C_BORDER}`, color: C_DIM,
            fontFamily: FONT, fontSize: 12, padding: "8px 16px", borderRadius: 4, cursor: "pointer",
          }}>create your first agent</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C_BG, fontFamily: FONT }}>
      {/* Header */}
      <div style={{
        height: 56, minHeight: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", borderBottom: `1px solid ${C_BORDER}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: C_TEXT, fontSize: 14, fontWeight: 600 }}>agents</span>
          <span style={{ color: C_DIMMER, fontSize: 12 }}>{agents.length}</span>
        </div>
        <button onClick={onCreateAgent} style={{
          background: "transparent", border: `1px solid ${C_ACCENT}`, color: C_ACCENT,
          fontFamily: FONT, fontSize: 12, padding: "6px 14px", borderRadius: 4, cursor: "pointer",
        }}>+ new agent</button>
      </div>

      {/* Office */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          style={{ display: "block", width: "100%", height: "100%", cursor: "pointer" }}
        />

        {/* Agent name labels (HTML overlays for crisp text) */}
        {npcsRef.current.map((npc) => {
          const lx = npc.tx * TILE + TILE / 2;
          const ly = npc.ty * TILE - 22;
          // Don't show if bubble is active (bubble takes that space)
          if (npc.bubbleTimer > 0) return null;
          return (
            <div
              key={npc.agent.id}
              onClick={(e) => { e.stopPropagation(); onEditAgent(npc.agent); }}
              style={{
                position: "absolute",
                left: lx,
                top: ly,
                transform: "translateX(-50%)",
                color: npc.agent.color || C_TEXT,
                fontSize: 9,
                fontFamily: FONT,
                fontWeight: 600,
                whiteSpace: "nowrap",
                pointerEvents: "auto",
                cursor: "pointer",
                textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                userSelect: "none",
              }}
            >
              {npc.agent.name}
            </div>
          );
        })}
      </div>
    </div>
  );
}
