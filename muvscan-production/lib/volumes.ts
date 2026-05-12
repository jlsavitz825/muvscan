// Volume estimation database and category helpers
// Falls back to these values when Claude's volume_cuft seems off or missing.

import type { ItemCategory } from './types';

export const ROOMS = [
  'Living Room',
  'Primary Bedroom',
  'Bedroom 2',
  'Bedroom 3',
  'Office',
  'Kitchen',
  'Dining Room',
  'Bathroom',
  'Garage',
  'Basement',
  'Attic',
  'Storage',
  'Hallway',
  'Outdoor',
] as const;

/** Realistic cubic-foot estimates for common moving items */
export const VOLUME_DB: Record<string, number> = {
  // Sofas / seating
  sofa: 70, couch: 70, loveseat: 48, sectional: 115, 'sofa bed': 80,
  armchair: 22, recliner: 30, chair: 20, 'office chair': 12, 'gaming chair': 14,
  bench: 16, stool: 4,

  // Tables
  'coffee table': 14, 'end table': 6, 'side table': 6, nightstand: 8,
  'accent table': 7, 'dining table': 45, 'kitchen table': 40,
  desk: 30, console: 22, buffet: 40, 'bar table': 18,

  // Storage
  bookshelf: 32, bookcase: 48, shelving: 28, 'shelving unit': 30,
  dresser: 35, chest: 28, wardrobe: 65, armoire: 72, cabinet: 28,
  'file cabinet': 18, 'tv stand': 18,

  // Beds
  'bed frame': 45, 'twin bed': 42, 'full bed': 55, 'queen bed': 65, 'king bed': 82,
  'twin mattress': 40, 'full mattress': 52, 'queen mattress': 65, 'king mattress': 82,
  crib: 30, bunk: 70,

  // Electronics
  tv: 8, television: 10, monitor: 4, computer: 6, laptop: 1, 'sound system': 8,
  speaker: 4, 'gaming console': 2,

  // Appliances
  refrigerator: 90, washer: 45, dryer: 42, microwave: 5, dishwasher: 45,
  'air conditioner': 8, fan: 4, heater: 6,

  // Lighting / decor
  lamp: 4, 'floor lamp': 5, chandelier: 6, mirror: 8, 'picture frame': 2,
  painting: 3, rug: 6, carpet: 8, plant: 3, 'large plant': 8,

  // Fitness / hobby
  piano: 120, 'upright piano': 130, keyboard: 12, guitar: 6, drums: 40,
  bike: 20, bicycle: 20, treadmill: 65, 'exercise bike': 25, elliptical: 55,
  weights: 12, 'workout bench': 22,

  // Storage boxes
  box: 3, 'moving box': 3, 'storage bin': 4, suitcase: 6, trunk: 12,

  // Outdoor / garage
  toolbox: 12, 'tool chest': 28, 'lawn mower': 24, grill: 22, 'patio chair': 14,
  'patio table': 30, ladder: 12,

  default: 15,
};

/** Look up a volume estimate by item name, falling back to default */
export function getVolume(name: string, apiVolume?: number): number {
  if (apiVolume && apiVolume > 0 && apiVolume < 500) return apiVolume;
  const n = name.toLowerCase();
  // Prefer longer/more specific keys first
  const keys = Object.keys(VOLUME_DB).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (n.includes(k)) return VOLUME_DB[k];
  }
  return VOLUME_DB.default;
}

/** Get a category emoji for an item */
export function getEmoji(name: string, category?: ItemCategory): string {
  const n = name.toLowerCase();
  if (/sofa|couch|sectional|loveseat/.test(n)) return '🛋️';
  if (/bed(?!.*spread)|mattress/.test(n)) return '🛏️';
  if (/tv|television/.test(n)) return '📺';
  if (/desk|workstation/.test(n)) return '🖥️';
  if (/chair|stool|bench/.test(n)) return '🪑';
  if (/dining table|kitchen table/.test(n)) return '🍽️';
  if (/table/.test(n)) return '🪵';
  if (/lamp|chandelier/.test(n)) return '💡';
  if (/rug|carpet/.test(n)) return '🎭';
  if (/shelf|bookcase|bookshelf/.test(n)) return '📚';
  if (/dresser|wardrobe|armoire|cabinet|chest/.test(n)) return '🗄️';
  if (/mirror/.test(n)) return '🪞';
  if (/painting|art|frame/.test(n)) return '🖼️';
  if (/piano|guitar|keyboard|drum/.test(n)) return '🎸';
  if (/plant|tree/.test(n)) return '🪴';
  if (/fridge|refrigerator/.test(n)) return '🧊';
  if (/washer|dryer/.test(n)) return '🌀';
  if (/microwave|dishwasher|oven|stove/.test(n)) return '🏠';
  if (/bike|bicycle/.test(n)) return '🚲';
  if (/treadmill|elliptical|exercise/.test(n)) return '🏃';
  if (/grill|patio|outdoor/.test(n)) return '🌳';
  if (/box|crate|bin|suitcase/.test(n)) return '📦';
  if (/ladder|tool/.test(n)) return '🔧';
  if (category === 'electronics') return '💻';
  if (category === 'appliance') return '🏠';
  if (category === 'fragile') return '🏺';
  if (category === 'boxes') return '📦';
  return '📦';
}

/** Standard truck capacities in cubic feet */
export const TRUCK_SIZES = [
  { name: "10' box truck", capacity: 400 },
  { name: "15' box truck", capacity: 800 },
  { name: "20' box truck", capacity: 1200 },
  { name: "26' box truck", capacity: 1700 },
  { name: 'Two trucks / large crew', capacity: 3400 },
] as const;

export function suggestTruck(totalVolume: number) {
  return TRUCK_SIZES.find((t) => totalVolume <= t.capacity) ?? TRUCK_SIZES[TRUCK_SIZES.length - 1];
}
