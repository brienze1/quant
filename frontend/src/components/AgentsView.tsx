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
const TICK_INTERVAL = 5;
const CANVAS_W = 760;
const CANVAS_H = 500;
const SIDEBAR_W = 220;

// CSS variable helper – reads a custom property from :root at call time
function getCSSVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// UI color fallbacks (used by canvas drawing; prefer getCSSVar() at render time)
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
  const gridW = Math.floor(canvasW / TILE);
  const gridH = Math.floor(canvasH / TILE);
  const occupied: boolean[][] = Array.from({ length: gridH }, () => Array(gridW).fill(false));
  const furniture: FurnitureItem[] = [];
  const desks: Rect[] = [];

  // Mark walls as occupied
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

  // --- Rug in center (large, warm red/maroon) ---
  const rugW = 8;
  const rugH = 5;
  const rugX = midX - Math.floor(rugW / 2);
  const rugY = midY - Math.floor(rugH / 2);
  furniture.push({ tx: rugX, ty: rugY, tw: rugW, th: rugH, kind: "rug" });

  // --- Desk Zone (top-left quadrant) ---
  const deskStartX = innerLeft + 2;
  const deskStartY = innerTop + 2;
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
      // Chair below desk
      if (dty + 2 < innerBottom && canPlace(dtx + 1, dty + 2, 1, 1)) {
        place(dtx + 1, dty + 2, 1, 1, "chair");
      }
    }
  }

  // --- Meeting Zone (top-right quadrant) ---
  const meetX = midX + 2;
  const meetY = innerTop + 2;
  // Whiteboard with cards
  if (meetX + 4 < innerRight && meetY + 1 < midY) {
    place(meetX, innerTop, 4, 1, "whiteboard");
  }
  // Round table
  if (canPlace(meetX + 1, meetY + 1, 2, 2)) {
    place(meetX + 1, meetY + 1, 2, 2, "meeting_table");
  }

  // --- Lounge Zone (bottom-left quadrant) ---
  const loungeX = innerLeft + 2;
  const loungeY = midY + 2;
  // Rug under lounge
  if (loungeX + 4 < midX && loungeY + 3 < innerBottom) {
    furniture.push({ tx: loungeX, ty: loungeY, tw: 4, th: 3, kind: "rug" });
  }
  // Couch
  if (canPlace(loungeX, loungeY + 3, 3, 1)) {
    place(loungeX, loungeY + 3, 3, 1, "couch");
  }
  // Coffee table
  if (canPlace(loungeX + 1, loungeY + 1, 2, 1)) {
    place(loungeX + 1, loungeY + 1, 2, 1, "coffee_table");
  }
  // Water cooler near lounge
  if (canPlace(loungeX + 5, loungeY, 1, 1)) {
    place(loungeX + 5, loungeY, 1, 1, "water_cooler");
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

  // --- Bookshelves along left wall ---
  for (let i = 0; i < 3; i++) {
    const bsy = innerTop + 1 + i * 3;
    if (bsy + 2 <= midY && canPlace(innerLeft, bsy, 1, 2)) {
      place(innerLeft, bsy, 1, 2, "bookshelf");
    }
  }

  // --- Bookshelves along right wall ---
  for (let i = 0; i < 2; i++) {
    const bsy = innerTop + 1 + i * 3;
    if (bsy + 2 <= midY && canPlace(innerRight - 1, bsy, 1, 2)) {
      place(innerRight - 1, bsy, 1, 2, "bookshelf");
    }
  }

  // --- Plants in corners and next to desks ---
  const plantPositions = [
    { tx: innerLeft + 1, ty: innerTop + 1 },
    { tx: innerRight - 2, ty: innerTop + 1 },
    { tx: innerLeft + 1, ty: innerBottom - 2 },
    { tx: innerRight - 2, ty: innerBottom - 2 },
    { tx: midX - 1, ty: innerTop + 1 },
    { tx: midX + 1, ty: innerBottom - 2 },
  ];
  for (const p of plantPositions) {
    if (p.tx >= 0 && p.tx < gridW && p.ty >= 0 && p.ty < gridH && canPlace(p.tx, p.ty, 1, 1)) {
      place(p.tx, p.ty, 1, 1, "plant");
    }
  }

  // --- Coat rack near entrance (bottom wall) ---
  const coatX = midX - 1;
  const coatY = innerBottom - 1;
  if (canPlace(coatX, coatY, 1, 1)) {
    place(coatX, coatY, 1, 1, "coat_rack");
  }

  // --- Door on bottom wall ---
  furniture.push({ tx: midX, ty: gridH - 1, tw: 2, th: 1, kind: "door" });

  // --- Posters/pictures on top wall ---
  const rng = makeRng(agents.length * 7 + 42);
  const posterCount = Math.min(agents.length + 2, 5);
  for (let i = 0; i < posterCount; i++) {
    const px = innerLeft + 2 + Math.floor(rng() * Math.max(1, (gridW - 8)));
    furniture.push({ tx: px, ty: 0, tw: 2, th: 1, kind: "poster", color: agents[i % agents.length]?.color });
  }

  // --- Ceiling lamp circles (light spots on floor) ---
  const lampPositions = [
    { tx: Math.floor(gridW * 0.25), ty: Math.floor(gridH * 0.3) },
    { tx: Math.floor(gridW * 0.75), ty: Math.floor(gridH * 0.3) },
    { tx: Math.floor(gridW * 0.25), ty: Math.floor(gridH * 0.7) },
    { tx: Math.floor(gridW * 0.75), ty: Math.floor(gridH * 0.7) },
    { tx: midX, ty: midY },
  ];
  for (const lp of lampPositions) {
    furniture.push({ tx: lp.tx - 1, ty: lp.ty - 1, tw: 3, th: 3, kind: "ceiling_lamp" });
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
  const speed = 0.15 + (enabledSkills / 80) * 0.25;
  const sociability = Math.min(enabledMcp / 3, 1.0);
  const restless = agent.autonomousMode ? 0.7 : 0.3;

  // Start near their desk or in a corridor
  let startTx = layout.gridW > 4 ? 3 + (index % Math.max(1, layout.gridW - 6)) : 3;
  let startTy = layout.gridH > 4 ? 3 + Math.floor(index / Math.max(1, layout.gridW - 6)) * 2 : 3;
  startTx = Math.min(startTx, layout.gridW - 2);
  startTy = Math.min(startTy, layout.gridH - 2);
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
    stateTimer: 60 + Math.floor(Math.random() * 90),
    walkFrame: 0,
    deskIdx: index < layout.desks.length ? index : -1,
    speed,
    sociability,
    restless,
    phrases: generatePhrases(agent),
    bubbleText: "",
    bubbleTimer: 0,
    bubbleCooldown: 400 + Math.floor(Math.random() * 400),
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
    npc.bubbleTimer = 120;
    npc.bubbleCooldown = 400 + Math.floor(Math.random() * 400);
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
          const tx = 2 + Math.floor(Math.random() * Math.max(1, layout.gridW - 4));
          const ty = 2 + Math.floor(Math.random() * Math.max(1, layout.gridH - 4));
          npc.targetTx = tx;
          npc.targetTy = ty;
          npc.state = "walking";
          npc.stateTimer = 600;
        } else if (roll < workChance && npc.deskIdx >= 0 && npc.deskIdx < layout.desks.length) {
          const desk = layout.desks[npc.deskIdx];
          npc.targetTx = desk.tx + 1;
          npc.targetTy = desk.ty + 2;
          if (npc.targetTy >= layout.gridH - 1) npc.targetTy = desk.ty - 1;
          npc.state = "walking";
          npc.stateTimer = 600;
        } else if (roll < socChance) {
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
            npc.stateTimer = 600;
          } else {
            npc.stateTimer = 60 + Math.floor(Math.random() * 90);
          }
        } else {
          const target = Math.random() > 0.5 ? layout.loungeCenter : layout.kitchenCenter;
          npc.targetTx = target.tx;
          npc.targetTy = target.ty;
          npc.state = "walking";
          npc.stateTimer = 600;
        }
      }
      break;
    }
    case "walking": {
      npc.stateTimer--;
      if (npc.stateTimer <= 0 || (npc.tx === npc.targetTx && npc.ty === npc.targetTy)) {
        if (npc.deskIdx >= 0 && npc.deskIdx < layout.desks.length) {
          const desk = layout.desks[npc.deskIdx];
          if (Math.abs(npc.tx - desk.tx - 1) <= 1 && Math.abs(npc.ty - desk.ty - 2) <= 1) {
            npc.state = "working";
            npc.dir = "up";
            npc.stateTimer = 200 + Math.floor(Math.random() * 200);
            break;
          }
        }
        for (const other of npcs) {
          if (other === npc) continue;
          if (Math.abs(other.tx - npc.tx) + Math.abs(other.ty - npc.ty) <= 2) {
            npc.state = "socializing";
            if (other.tx > npc.tx) npc.dir = "right";
            else if (other.tx < npc.tx) npc.dir = "left";
            else if (other.ty > npc.ty) npc.dir = "down";
            else npc.dir = "up";
            npc.stateTimer = 100 + Math.floor(Math.random() * 80);
            break;
          }
        }
        if (npc.state === "walking") {
          npc.state = "idle";
          npc.stateTimer = 60 + Math.floor(Math.random() * 90);
        }
        break;
      }

      // Move one tile toward target (greedy)
      const dx = npc.targetTx - npc.tx;
      const dy = npc.targetTy - npc.ty;
      let nextTx = npc.tx;
      let nextTy = npc.ty;

      if (dx !== 0) {
        nextTx = npc.tx + (dx > 0 ? 1 : -1);
        npc.dir = dx > 0 ? "right" : "left";
      } else if (dy !== 0) {
        nextTy = npc.ty + (dy > 0 ? 1 : -1);
        npc.dir = dy > 0 ? "down" : "up";
      }

      if (nextTx >= 1 && nextTx < layout.gridW - 1 && nextTy >= 1 && nextTy < layout.gridH - 1 &&
          !layout.occupied[nextTy][nextTx]) {
        npc.tx = nextTx;
        npc.ty = nextTy;
      } else {
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
        npc.stateTimer = 60 + Math.floor(Math.random() * 90);
      }
      break;
    }
    case "socializing": {
      npc.stateTimer--;
      if (npc.stateTimer <= 0) {
        npc.state = "idle";
        npc.stateTimer = 60 + Math.floor(Math.random() * 90);
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
  ctx.fillRect(0, 0, w, WALL_T);
  ctx.fillRect(0, h - WALL_T, w, WALL_T);
  ctx.fillRect(0, 0, WALL_T, h);
  ctx.fillRect(w - WALL_T, 0, WALL_T, h);

  // Inner trim
  ctx.fillStyle = C_WALL_TRIM;
  ctx.fillRect(WALL_T, WALL_T, w - WALL_T * 2, 2);
  ctx.fillRect(WALL_T, h - WALL_T - 2, w - WALL_T * 2, 2);
  ctx.fillRect(WALL_T, WALL_T, 2, h - WALL_T * 2);
  ctx.fillRect(w - WALL_T - 2, WALL_T, 2, h - WALL_T * 2);
}

function drawDoor(ctx: CanvasRenderingContext2D, item: FurnitureItem) {
  const x = item.tx * TILE;
  const y = item.ty * TILE;
  const w = item.tw * TILE;
  const h = item.th * TILE;
  // Dark gap in wall
  ctx.fillStyle = "#1A1A0A";
  ctx.fillRect(x, y, w, h);
  // Door frame
  ctx.fillStyle = C_WALL_TRIM;
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
}

function drawFurniture(ctx: CanvasRenderingContext2D, item: FurnitureItem, agents: Agent[]) {
  const x = item.tx * TILE;
  const y = item.ty * TILE;
  const w = item.tw * TILE;
  const h = item.th * TILE;

  switch (item.kind) {
    case "desk": {
      ctx.fillStyle = C_DESK_SIDE;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = C_DESK_TOP;
      ctx.fillRect(x + 1, y + 1, w - 2, h / 2);
      // Monitor
      ctx.fillStyle = "#111";
      ctx.fillRect(x + w / 2 - 6, y + 3, 12, 8);
      if (item.color) {
        ctx.fillStyle = item.color;
        ctx.fillRect(x + w / 2 - 4, y + 5, 8, 1);
        ctx.fillRect(x + w / 2 - 3, y + 7, 6, 1);
      }
      break;
    }
    case "chair": {
      ctx.fillStyle = C_COUCH_FRAME;
      ctx.fillRect(x + 4, y + 2, TILE - 8, TILE - 4);
      ctx.fillStyle = C_COUCH_CUSHION;
      ctx.fillRect(x + 5, y + 3, TILE - 10, TILE - 6);
      break;
    }
    case "whiteboard": {
      ctx.fillStyle = C_WHITEBOARD;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = C_DIMMER;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      // Colored cards on whiteboard
      const cardColors = ["#EF4444", "#3B82F6", C_ACCENT, "#F59E0B", "#A855F7"];
      for (let i = 0; i < Math.min(agents.length + 2, 6); i++) {
        ctx.fillStyle = cardColors[i % cardColors.length];
        ctx.fillRect(x + 4 + i * 10, y + h / 2 - 3, 8, 5);
      }
      break;
    }
    case "meeting_table": {
      ctx.fillStyle = C_DESK_TOP;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 * 0.9, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.strokeStyle = C_RUG_B;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      break;
    }
    case "couch": {
      ctx.fillStyle = C_COUCH_FRAME;
      ctx.fillRect(x, y, w, h);
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
      ctx.fillStyle = C_DESK_SIDE;
      ctx.fillRect(x, y, 3, 3);
      ctx.fillRect(x + w - 3, y, 3, 3);
      ctx.fillRect(x, y + h - 3, 3, 3);
      ctx.fillRect(x + w - 3, y + h - 3, 3, 3);
      break;
    }
    case "plant": {
      ctx.fillStyle = C_PLANT_POT;
      ctx.fillRect(x + 4, y + h - 8, TILE - 8, 8);
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
      ctx.fillStyle = C_DIMMER;
      ctx.fillRect(x + w - 4, y + 6, 2, h - 12);
      ctx.fillStyle = "#B0B0B0";
      ctx.fillRect(x + 1, y + Math.floor(h * 0.4), w - 2, 1);
      break;
    }
    case "coffee_machine": {
      ctx.fillStyle = "#333";
      ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      ctx.fillStyle = "#EF4444";
      ctx.fillRect(x + TILE - 6, y + 5, 2, 2);
      break;
    }
    case "water_cooler": {
      ctx.fillStyle = "#9DD5EA";
      ctx.fillRect(x + 4, y + 2, TILE - 8, TILE - 6);
      ctx.fillStyle = "#C5E8F5";
      ctx.fillRect(x + 5, y + 3, TILE - 10, 4);
      // Base
      ctx.fillStyle = "#666";
      ctx.fillRect(x + 3, y + TILE - 4, TILE - 6, 4);
      break;
    }
    case "bookshelf": {
      ctx.fillStyle = "#4A3020";
      ctx.fillRect(x, y, w, h);
      // Shelves
      const shelfCount = Math.floor(h / 8);
      for (let s = 0; s < shelfCount; s++) {
        ctx.fillStyle = "#5A3A28";
        ctx.fillRect(x + 1, y + 2 + s * 8, w - 2, 1);
        // Books
        const bookColors = ["#EF4444", "#3B82F6", "#22C55E", "#F59E0B", "#A855F7"];
        for (let b = 0; b < 3; b++) {
          ctx.fillStyle = bookColors[(s + b) % bookColors.length];
          ctx.fillRect(x + 2 + b * 5, y + s * 8 + 3, 4, 5);
        }
      }
      break;
    }
    case "coat_rack": {
      // Pole
      ctx.fillStyle = "#666";
      ctx.fillRect(x + TILE / 2 - 1, y + 2, 2, TILE - 4);
      // Hooks
      ctx.fillStyle = "#888";
      ctx.fillRect(x + 3, y + 4, 4, 2);
      ctx.fillRect(x + TILE - 7, y + 4, 4, 2);
      // Base
      ctx.fillRect(x + 4, y + TILE - 3, TILE - 8, 3);
      break;
    }
    case "ceiling_lamp": {
      // Subtle light spot on floor
      const cx = x + w / 2;
      const cy = y + h / 2;
      const radius = Math.min(w, h) / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, "rgba(255, 240, 200, 0.06)");
      grad.addColorStop(1, "rgba(255, 240, 200, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
      break;
    }
    case "server_rack": {
      ctx.fillStyle = C_SERVER;
      ctx.fillRect(x, y, w, h);
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
      const colW = Math.floor(w / 3);
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = "#333";
        ctx.fillRect(x + c * colW, y, 1, h);
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
    case "door": {
      drawDoor(ctx, item);
      break;
    }
  }
}

function drawSprite(ctx: CanvasRenderingContext2D, npc: Npc, _tick: number) {
  const px = npc.tx * TILE + (TILE - SPRITE_W * PX) / 2;
  let py = npc.ty * TILE + (TILE - SPRITE_H * PX) / 2;

  if (npc.state === "working") {
    py += npc.workBob < 10 ? -1 : 1;
  }

  const color = npc.agent.color || C_ACCENT;
  const frame = npc.state === "walking" ? npc.walkFrame : 0;
  const isWalkA = frame < 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(px + PX, py + SPRITE_H * PX - PX, SPRITE_W * PX - PX * 2, PX);

  const dot = (gx: number, gy: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(px + gx * PX, py + gy * PX, PX, PX);
  };

  // --- Head (rows 0-3) ---
  const skinColor = "#F5D0A9";
  const hairColor = darkenColor(color, 0.4);

  for (let i = 2; i <= 5; i++) dot(i, 0, hairColor);

  if (npc.dir === "down") {
    dot(1, 1, hairColor); dot(2, 1, skinColor); dot(3, 1, skinColor);
    dot(4, 1, skinColor); dot(5, 1, skinColor); dot(6, 1, hairColor);
    dot(1, 2, hairColor); dot(2, 2, skinColor); dot(3, 2, "#333");
    dot(4, 2, skinColor); dot(5, 2, "#333");
    dot(6, 2, skinColor);
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

  const alpha = npc.bubbleTimer < 20 ? npc.bubbleTimer / 20 : 1;
  ctx.globalAlpha = alpha;

  // Background
  ctx.fillStyle = getCSSVar("--q-fg", C_TEXT);
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 3);
  ctx.fill();

  // Border
  ctx.strokeStyle = getCSSVar("--q-border", C_BORDER);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Tail
  ctx.fillStyle = getCSSVar("--q-fg", C_TEXT);
  ctx.beginPath();
  ctx.moveTo(px - 3, by + bh);
  ctx.lineTo(px, by + bh + 4);
  ctx.lineTo(px + 3, by + bh);
  ctx.fill();

  // Text
  ctx.fillStyle = getCSSVar("--q-bg-elevated", "#111111");
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const npcsRef = useRef<Npc[]>([]);
  const layoutRef = useRef<OfficeLayout | null>(null);
  const frameRef = useRef(0);
  const tickRef = useRef(0);
  const rafRef = useRef(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ agent: Agent; x: number; y: number } | null>(null);
  const [hoveredSidebarId, setHoveredSidebarId] = useState<string | null>(null);

  // Build layout + NPCs when agents change
  const rebuildLayout = useCallback((agentList: Agent[]) => {
    const layout = buildOfficeLayout(CANVAS_W, CANVAS_H, agentList);
    layoutRef.current = layout;

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

  // Rebuild when agents change
  useEffect(() => {
    rebuildLayout(agents);
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
      const layout = layoutRef.current;
      const npcs = npcsRef.current;

      if (layout) {
        canvas!.width = CANVAS_W;
        canvas!.height = CANVAS_H;

        frameRef.current++;
        if (frameRef.current % TICK_INTERVAL === 0) {
          tickRef.current++;
          for (const npc of npcs) {
            tickNpc(npc, npcs, layout);
          }
        }

        ctx.fillStyle = getCSSVar("--q-bg", C_BG);
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        drawFloor(ctx, CANVAS_W, CANVAS_H);
        drawWalls(ctx, CANVAS_W, CANVAS_H);

        // Furniture: ceiling lamps first, then rugs, then rest
        for (const item of layout.furniture) {
          if (item.kind === "ceiling_lamp") drawFurniture(ctx, item, agents);
        }
        for (const item of layout.furniture) {
          if (item.kind === "rug") drawFurniture(ctx, item, agents);
        }
        for (const item of layout.furniture) {
          if (item.kind !== "rug" && item.kind !== "ceiling_lamp") drawFurniture(ctx, item, agents);
        }

        drawServerLeds(ctx, layout, tickRef.current);

        const sorted = [...npcs].sort((a, b) => a.ty - b.ty);
        for (const npc of sorted) {
          drawSprite(ctx, npc, tickRef.current);
        }
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
  }, [agents]);

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
        setSelectedAgentId(npc.agent.id);
        setPopup({
          agent: npc.agent,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        return;
      }
    }
    // Clicked empty space
    setPopup(null);
  }, []);

  // Dismiss popup on outside click
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    // Only dismiss if clicking the container background (not sidebar, not canvas, not popup)
    if ((e.target as HTMLElement).dataset.dismissPopup === "true") {
      setPopup(null);
    }
  }, []);

  // Empty state
  if (agents.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", overflow: "hidden", background: "var(--q-bg)", fontFamily: FONT }}>
        {/* Header */}
        <div style={{
          height: 56, minHeight: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", borderBottom: "1px solid var(--q-border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--q-fg)", fontSize: 14, fontWeight: 600 }}>agents</span>
            <span style={{ color: "var(--q-fg-muted)", fontSize: 12 }}>0</span>
          </div>
          <button onClick={onCreateAgent} style={{
            background: "transparent", border: "1px solid var(--q-accent)", color: "var(--q-accent)",
            fontFamily: FONT, fontSize: 12, padding: "6px 14px", borderRadius: 4, cursor: "pointer",
          }}>+ new agent</button>
        </div>
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <span style={{ color: "var(--q-fg-muted)", fontSize: 13 }}>no agents yet</span>
          <button onClick={onCreateAgent} style={{
            background: "transparent", border: "1px solid var(--q-border)", color: "var(--q-fg-secondary)",
            fontFamily: FONT, fontSize: 12, padding: "8px 16px", borderRadius: 4, cursor: "pointer",
          }}>create your first agent</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", overflow: "hidden", background: "var(--q-bg)", fontFamily: FONT }}>
      {/* Header */}
      <div style={{
        height: 56, minHeight: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", borderBottom: "1px solid var(--q-border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--q-fg)", fontSize: 14, fontWeight: 600 }}>agents</span>
          <span style={{ color: "var(--q-fg-muted)", fontSize: 12 }}>{agents.length}</span>
        </div>
        <button onClick={onCreateAgent} style={{
          background: "transparent", border: "1px solid var(--q-accent)", color: "var(--q-accent)",
          fontFamily: FONT, fontSize: 12, padding: "6px 14px", borderRadius: 4, cursor: "pointer",
        }}>+ new agent</button>
      </div>

      {/* Body: sidebar + office */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Agent List Sidebar */}
        <div style={{
          width: SIDEBAR_W, minWidth: SIDEBAR_W, background: "var(--q-bg-elevated)", borderRight: "1px solid var(--q-border)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Sidebar header */}
          <div style={{ padding: "10px 12px 6px 12px" }}>
            <span style={{ color: "var(--q-fg-muted)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>agents</span>
          </div>

          {/* Agent list */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
            {agents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              const isHovered = hoveredSidebarId === agent.id;
              return (
                <div
                  key={agent.id}
                  onClick={() => onEditAgent(agent)}
                  onMouseEnter={() => setHoveredSidebarId(agent.id)}
                  onMouseLeave={() => setHoveredSidebarId(null)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 12px",
                    cursor: "pointer",
                    background: isHovered ? "var(--q-bg-surface)" : "transparent",
                    borderLeft: isSelected ? "2px solid var(--q-accent)" : "2px solid transparent",
                  }}
                >
                  {/* Color dot */}
                  <div style={{
                    width: 6, height: 6, minWidth: 6, borderRadius: "50%",
                    background: agent.color || "var(--q-accent)",
                  }} />
                  {/* Name + model */}
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{
                      color: "var(--q-fg)", fontSize: 11, fontWeight: 600, fontFamily: FONT,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{agent.name}</div>
                    <div style={{
                      color: "var(--q-fg-muted)", fontSize: 9, fontFamily: FONT,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{agent.model}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Create agent button at bottom */}
          <div
            onClick={onCreateAgent}
            onMouseEnter={() => setHoveredSidebarId("__create__")}
            onMouseLeave={() => setHoveredSidebarId(null)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 12px",
              cursor: "pointer",
              borderTop: "1px solid var(--q-border)",
              background: hoveredSidebarId === "__create__" ? "var(--q-bg-surface)" : "transparent",
            }}
          >
            <span style={{ color: "var(--q-fg-muted)", fontSize: 12 }}>+</span>
            <span style={{ color: "var(--q-fg-muted)", fontSize: 11, fontFamily: FONT }}>create agent</span>
          </div>
        </div>

        {/* Office area */}
        <div
          onClick={handleContainerClick}
          data-dismiss-popup="true"
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", position: "relative",
          }}
        >
          <div style={{ position: "relative" }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onClick={handleCanvasClick}
              style={{ display: "block", width: CANVAS_W, height: CANVAS_H, cursor: "pointer" }}
            />

            {/* Agent info popup */}
            {popup && (() => {
              // Position popup near click, but keep it within canvas bounds
              let popupX = popup.x + 10;
              let popupY = popup.y - 10;
              const popupW = 180;
              const popupH = 90;
              if (popupX + popupW > CANVAS_W) popupX = popup.x - popupW - 10;
              if (popupY + popupH > CANVAS_H) popupY = CANVAS_H - popupH - 4;
              if (popupY < 0) popupY = 4;

              return (
                <div
                  onClick={(e) => { e.stopPropagation(); onEditAgent(popup.agent); setPopup(null); }}
                  style={{
                    position: "absolute",
                    left: popupX,
                    top: popupY,
                    width: popupW,
                    background: "var(--q-bg-surface)",
                    border: "1px solid var(--q-border)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    cursor: "pointer",
                    zIndex: 10,
                    fontFamily: FONT,
                  }}
                >
                  <div style={{
                    color: popup.agent.color || "var(--q-fg)", fontSize: 12, fontWeight: 700,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    marginBottom: 4,
                  }}>{popup.agent.name}</div>
                  <div style={{
                    color: "var(--q-fg-secondary)", fontSize: 10,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    marginBottom: 2,
                  }}>{popup.agent.role || "no role"}</div>
                  <div style={{
                    color: "var(--q-fg-muted)", fontSize: 9,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    marginBottom: 6,
                  }}>{popup.agent.goal || "no goal"}</div>
                  <div style={{
                    color: "var(--q-fg-muted)", fontSize: 8, fontStyle: "italic",
                  }}>click to edit</div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
