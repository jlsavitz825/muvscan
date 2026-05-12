// Shared type definitions for MüvScan

/** Categories Claude returns for each detected item */
export type ItemCategory =
  | 'furniture'
  | 'electronics'
  | 'appliance'
  | 'fragile'
  | 'boxes'
  | 'misc';

/** Normalized bounding box coordinates (0-1) from Claude vision */
export interface BoundingBox {
  x: number; // top-left x
  y: number; // top-left y
  w: number; // width
  h: number; // height
}

/** Raw detection returned by the /api/scan endpoint */
export interface ApiDetection {
  name: string;
  category: ItemCategory;
  bbox: BoundingBox;
  volume_cuft: number;
  weight_lb: number;
  fragile: boolean;
  heavy: boolean;
  disassembly_needed: boolean;
  confidence: number;
}

/** Detection in the client's state, with UI tracking fields */
export interface Detection extends ApiDetection {
  id: string;
  dismissed: boolean;
  added: boolean;
}

/** Inventory item — the canonical record after the user adds something */
export interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  emoji: string;
  vol: number;
  wt: number;
  qty: number;
  room: string;
  fragile: boolean;
  heavy: boolean;
  disassemblyNeeded: boolean;
  addedAt: string; // ISO timestamp
}

export type ScanStatus = 'idle' | 'scanning' | 'analyzing' | 'error';

export interface ScanApiResponse {
  items: ApiDetection[];
}

export interface ScanApiError {
  error: string;
}
