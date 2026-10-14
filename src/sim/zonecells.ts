/**
 * Contracts for segment-frame zoning (docs/process/05-oriented-lots.md §1.1 and §2.1).
 * Types and constants only: every phase compiles against this file, so its shape is the stable interface between
 * zoneblocks.ts (blocks), orientedlots.ts (lots), mirror.ts (tile mirror), save v2 and the renderer.
 */
import type { ZoneType } from "./world";

/** Which side of the segment (looking from node a toward node b): -1 = left, +1 = right. */
export type Side = -1 | 1;

export const CELL_DEPTH = 4;          // ZONE_DEPTH today (blocks.ts); columns 0..3
export const BLOCK_MAX_ROWS = 8;      // CS1: segments longer than 8 cells split into several blocks
export const CELL_SLOPE_LIMIT = 1.0;  // ZONE_SLOPE_LIMIT today (blocks.ts)

/** A cell address. Stable while the owning segment keeps its id and shape. */
export interface CellRef { seg: number; side: Side; block: number; row: number; col: number }

/** A block is one rectangle of rows × CELL_DEPTH cells on one side of one segment. */
export interface ZoneBlock {
  key: string;                 // `${seg}:${side}:${block}`: map key, never saved as a float
  seg: number;
  side: Side;
  block: number;               // index along the segment, 0 = at node a
  rows: number;                // 1..BLOCK_MAX_ROWS
  /** Arclength (tiles, from node a) of the centre of row r: s0 + r. */
  s0: number;
  /** Lateral offset (tiles, from the centreline) of the centre of column 0; column c is at lat0 + c. */
  lat0: number;
  /** Per-row frame: cell centre of (row, 0) and the unit tangent of the segment there. Length rows*4. */
  frame: Float32Array;         // [ox, oz, tx, tz] per row
  /**
   * Per-boundary centreline frame for trapezoid cells (Z2, fable `_buildFrame`).
   * Length (rows+1)*4: [x, z, tx, tz] at arclength s0 + k - 0.5, k = 0..rows,
   * extrapolated beyond the segment ends so straight streets keep full squares.
   * Absent in old fixtures; cellCorners falls back to unit squares.
   */
  edge?: Float32Array;
  /** Cell state, row-major (index = row * CELL_DEPTH + col). */
  valid: Uint8Array;           // 1 = may hold zone (slope, obstacles, row cut-off, overlap resolution applied)
  zone: Uint8Array;            // ZONE.*; 0 = unzoned. Only meaningful where valid = 1.
  level: Uint8Array;           // 0..3, mirrored from the lot that owns the cell
  lot: Int32Array;             // lot id or -1
  /** Owner segment's creation order for tie-breaks (segment ids are monotonic). */
  age: number;
}

export interface CellPose { x: number; z: number; yaw: number; tx: number; tz: number; nx: number; nz: number }

export interface OrientedLot {
  id: number;
  /** Anchor cell: block and the (row, col) of the lot's front-left cell. */
  seg: number; side: Side; block: number; row: number; col: number;
  /** Size in cells: w along the road (rows), d into the block (cols). 1..4 each. */
  w: number; d: number;
  zone: ZoneType;
  level: number;              // 0 empty, 1..3
  /** Build progress; absent only in pre-construction saves and treated as complete. */
  build?: number;
  construction?: ConstructionState;
  /** Rare city landmark; optional so all existing saves remain valid. */
  landmark?: import("./landmarks").LandmarkId;
  /** Derived pose: centre and yaw such that a model's +z faces the road. Recomputed from the block, never saved. */
  cx: number; cz: number; yaw: number;
  /** Mirror: tile indices whose centre lies inside the lot's rectangle (at least 1). Derived. */
  tiles: number[];
}

export type ConstructionPhase = "planned" | "excavation" | "structure" | "finishing" | "complete" | "paused" | "upgrading";
/** Persisted per-building schedule; absent on an old save means complete. */
export interface ConstructionState { state: ConstructionPhase; progress: number; duration: number; upgrading?: boolean }

/** Derived cache: every zone block of the world, keyed by ZoneBlock.key. */
export type ZoneBlockSet = Map<string, ZoneBlock>;

export type ZoningMode = "tiles" | "oriented";
