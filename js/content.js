// Crossword Journey — versioned content: themes, word bank, grid patterns,
// the seeded fill generator, journey stages, lessons, daily, practice,
// challenges, and offline validators. Pure module (browser + Node).
//
// Solution class: a puzzle's accepted solution is exactly the fill produced
// by generateGrid() for its seed. The fill is constructive (the generator
// places real bank words), so a solution always exists; rules.win requires
// matching it letter-for-letter, which is the accepted uniqueness class.

import { createStream, hashSeed } from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Visual themes (presentation only — never affect rules or information)
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'harbor', name: 'Harbor Dawn',
    paper: '#f6efe0', ink: '#26313d', tile: '#fdfaf1', tileEdge: '#d9cfae',
    accent: '#d96c47', select: '#2f80ed', ok: '#3f9d63', wrong: '#c0392b',
    revealed: '#8a6fd0', sky: '#bfe0e6', ground: '#e8dfc8',
    water: '#4f8ea8', hill: '#7fae8e', tree: '#3f7a5c', rock: '#9a8f7a',
  },
  {
    id: 'pine', name: 'Pine Ridge',
    paper: '#eef0e4', ink: '#24352b', tile: '#fbfdf4', tileEdge: '#c9d2b4',
    accent: '#c96f2e', select: '#2f80ed', ok: '#3f9d63', wrong: '#c0392b',
    revealed: '#8a6fd0', sky: '#cfdcc8', ground: '#dde3cd',
    water: '#5c8a96', hill: '#6f9a6a', tree: '#2f5c44', rock: '#8d8a78',
  },
  {
    id: 'desert', name: 'Desert Meridian',
    paper: '#f8ecd9', ink: '#3d2f26', tile: '#fdf7ea', tileEdge: '#e0cba4',
    accent: '#b6543a', select: '#2f80ed', ok: '#3f9d63', wrong: '#c0392b',
    revealed: '#8a6fd0', sky: '#f2d9a7', ground: '#eedcb9',
    water: '#6aa5b8', hill: '#d9b678', tree: '#7a9a4e', rock: '#b08c5e',
  },
  {
    id: 'frost', name: 'Frost Lantern',
    paper: '#e9eef4', ink: '#232c3c', tile: '#f7fafd', tileEdge: '#bcc9d8',
    accent: '#d9764a', select: '#3a6fd8', ok: '#3f9d63', wrong: '#c0392b',
    revealed: '#8a6fd0', sky: '#aebfd8', ground: '#dbe4ee',
    water: '#5f86a8', hill: '#93a8c4', tree: '#4e6e62', rock: '#7c8aa0',
  },
  {
    id: 'orchard', name: 'Orchard Rail',
    paper: '#f7efe8', ink: '#3a2c33', tile: '#fdf9f4', tileEdge: '#dcc3c3',
    accent: '#c94f6d', select: '#2f80ed', ok: '#3f9d63', wrong: '#c0392b',
    revealed: '#8a6fd0', sky: '#e3d5e0', ground: '#e9dfd2',
    water: '#6d97a8', hill: '#9ab87a', tree: '#55804a', rock: '#a89a8c',
  },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ---------------------------------------------------------------------------
// Word bank — original words and clues. d: 1 common, 2 moderate, 3 tricky.
// ---------------------------------------------------------------------------

export const WORD_BANK = {
  3: [
    ['ACE', 'Top card in many decks', 1], ['AIR', 'What fills a sail', 1],
    ['ANT', 'Tiny trail worker', 1], ['ARC', 'Curved path', 1],
    ['ARM', 'Sleeve filler', 1], ['ART', 'Museum wall filler', 1],
    ['ASH', 'Fireplace residue', 1], ['AXE', 'Woodsman\'s chopper', 1],
    ['BAY', 'Wide curved shoreline', 1], ['BEE', 'Hive worker', 1],
    ['BOW', 'Ribbon tie', 1], ['BOX', 'Cardboard container', 1],
    ['BUS', 'City road cruiser', 1], ['CAB', 'Curbside hail', 1],
    ['CAP', 'Brimmed headwear', 1], ['CAR', 'Garage dweller', 1],
    ['CAT', 'Purring pet', 1], ['COW', 'Pasture mooer', 1],
    ['CUP', 'Teatime vessel', 1], ['DAY', 'Twenty-four hours', 1],
    ['DEN', 'Lion\'s lair', 1], ['DEW', 'Morning droplets', 1],
    ['DOG', 'Loyal barker', 1], ['EAR', 'Corn unit', 1],
    ['EGG', 'Omelet base', 1], ['ELK', 'Antlered grazer', 1],
    ['ELM', 'Stately shade tree', 1], ['EYE', 'Sight organ', 1],
    ['FAN', 'Breeze maker', 1], ['FIG', 'Sweet teardrop fruit', 2],
    ['FOG', 'Low-lying cloud', 1], ['FOX', 'Sly red tail', 1],
    ['GEM', 'Cut stone', 1], ['GUM', 'Chewy stick', 1],
    ['HAT', 'Head cover', 1], ['HEN', 'Egg layer', 1],
    ['ICE', 'Frozen water', 1], ['INK', 'Pen filler', 1],
    ['JAM', 'Toast spread', 1], ['JAR', 'Preserves holder', 1],
    ['KEY', 'Lock opener', 1], ['KIT', 'Set of tools', 1],
    ['LOG', 'Fallen trunk piece', 1], ['MAP', 'Traveler\'s folded guide', 1],
    ['MUD', 'Wet dirt', 1], ['NET', 'Catcher\'s mesh', 1],
    ['OAK', 'Acorn\'s parent', 1], ['OAR', 'Rowing blade', 1],
    ['OWL', 'Night hooter', 1], ['PEN', 'Writing tool', 1],
    ['PIE', 'Crusted dessert', 1], ['RAG', 'Cleaning cloth', 1],
    ['RAM', 'Bighorn male', 2], ['RAT', 'Sewer scurrier', 1],
    ['RAY', 'Beam of light', 1], ['RIB', 'Chest bone', 1],
    ['ROW', 'Line of seats', 1], ['RYE', 'Hearty bread grain', 2],
    ['SEA', 'Vast salt water', 1], ['SKY', 'Blue expanse', 1],
    ['SUN', 'Daytime star', 1], ['TEA', 'Steeped drink', 1],
    ['TEN', 'X, to the Romans', 2], ['TIN', 'Can metal', 1],
    ['TOE', 'Shoe-front occupant', 1], ['TOP', 'Highest point', 1],
    ['VAN', 'Mover\'s vehicle', 1], ['WAX', 'Candle stuff', 1],
    ['YAK', 'Shaggy mountain bovine', 2], ['ZOO', 'Animal park', 1],
  ],
  4: [
    ['ARCH', 'Curved span', 1], ['BARN', 'Farm storage building', 1],
    ['BEAR', 'Forest forager', 1], ['BELL', 'Tower ringer', 1],
    ['BIRD', 'Feathered singer', 1], ['BOAT', 'Harbor vessel', 1],
    ['BOOK', 'Page-filled read', 1], ['BOOT', 'Hiking footwear', 1],
    ['CAFE', 'Coffee stop', 1], ['CAKE', 'Birthday dessert', 1],
    ['CAMP', 'Tent site', 1], ['CARD', 'Dealt rectangle', 1],
    ['CAVE', 'Hillside hollow', 1], ['CLAY', 'Potter\'s material', 1],
    ['COAT', 'Winter layer', 1], ['COIN', 'Pocket-change piece', 1],
    ['COLD', 'Winter feeling', 1], ['CRAB', 'Sideways walker', 1],
    ['CREW', 'Ship\'s team', 1], ['DOCK', 'Boat\'s parking spot', 1],
    ['DOVE', 'Peace-symbol bird', 1], ['DRUM', 'Beaten instrument', 1],
    ['DUSK', 'Day\'s-end light', 1], ['FERN', 'Shady frond plant', 2],
    ['FIRE', 'Camp light source', 1], ['FISH', 'River swimmer', 1],
    ['FLAG', 'Pole topper', 1], ['FROG', 'Pond hopper', 1],
    ['GATE', 'Fence opening', 1], ['GLOW', 'Soft steady light', 1],
    ['GOAT', 'Bearded mountain climber', 1], ['GOLD', 'Panned treasure', 1],
    ['GULF', 'Very large bay', 2], ['HARP', 'Angelic strings', 2],
    ['HILL', 'Small mountain', 1], ['HUSK', 'Corn covering', 2],
    ['IRON', 'Golf-bag metal', 1], ['JADE', 'Green gemstone', 2],
    ['KITE', 'Wind toy', 1], ['LACE', 'Shoe string', 1],
    ['LAKE', 'Inland water', 1], ['LAMP', 'Desk light', 1],
    ['LEAF', 'Tree blade', 1], ['LION', 'Savanna king', 1],
    ['LOCK', 'Canal staircase', 2], ['MEAD', 'Honey wine', 3],
    ['MIST', 'Thin fog', 1], ['MOON', 'Night light', 1],
    ['MOSS', 'Soft green ground cover', 1], ['NEST', 'Bird\'s home', 1],
    ['NOTE', 'Short written message', 1], ['PARK', 'Green city space', 1],
    ['PATH', 'Walking way', 1], ['PEAR', 'Orchard fruit', 1],
    ['PINE', 'Needled tree', 1], ['PORT', 'Harbor town', 1],
    ['QUAY', 'Stone wharf', 3],
    ['RAIL', 'Train-track bar', 1], ['RAIN', 'Umbrella weather', 1],
    ['RING', 'Finger band', 1], ['ROAD', 'Driving route', 1],
    ['ROPE', 'Climber\'s line', 1], ['ROSE', 'Thorny bloom', 1],
    ['SAIL', 'Wind catcher', 1], ['SAND', 'Beach grains', 1],
    ['SEAL', 'Ice-floe lounger', 2], ['SEED', 'Plant starter', 1],
    ['SHIP', 'Ocean vessel', 1], ['SNOW', 'Winter fall', 1],
    ['SOIL', 'Garden dirt', 1], ['STAR', 'Night twinkler', 1],
    ['TENT', 'Camper\'s shelter', 1], ['TREE', 'Forest giant', 1],
    ['VALE', 'Poetic valley', 3], ['VINE', 'Climbing plant', 1],
    ['WAVE', 'Surf curl', 1], ['WOLF', 'Pack howler', 1],
    ['WOOL', 'Sheep\'s coat', 1], ['YARD', 'House\'s green space', 1],
  ],
  5: [
    ['ABBEY', 'Monastery complex', 2], ['ACORN', 'Oak\'s seed', 1],
    ['AMBER', 'Fossil resin', 2], ['ANVIL', 'Blacksmith\'s block', 2],
    ['APPLE', 'Orchard snack', 1], ['ARROW', 'Quiver occupant', 1],
    ['BASIL', 'Pesto herb', 2], ['BEACH', 'Sandy shore', 1],
    ['BERRY', 'Small juicy fruit', 1], ['BIRCH', 'White-barked tree', 2],
    ['BREAD', 'Bakery staple', 1], ['BROOK', 'Small stream', 1],
    ['CABIN', 'Woods retreat', 1], ['CANAL', 'Dug waterway', 2],
    ['CANOE', 'Paddled craft', 1], ['CEDAR', 'Aromatic lumber tree', 2],
    ['CHAIR', 'Table seat', 1], ['CHEST', 'Treasure box', 1],
    ['CLIFF', 'Steep rock face', 1], ['CLOUD', 'Sky drifter', 1],
    ['COAST', 'Land\'s edge', 1], ['COMET', 'Tailed sky visitor', 2],
    ['CRANE', 'Long-legged wader', 2], ['CREEK', 'Narrow stream', 1],
    ['CROWN', 'Royal headwear', 1], ['DELTA', 'River\'s-end fan', 2],
    ['EAGLE', 'Soaring raptor', 1], ['EMBER', 'Dying-fire glow', 2],
    ['FERRY', 'Shuttling boat', 1], ['FIELD', 'Open meadow', 1],
    ['FJORD', 'Glacial inlet', 3], ['FLAME', 'Fire tongue', 1],
    ['FLINT', 'Spark stone', 2], ['FLUTE', 'Breathy instrument', 1],
    ['FROST', 'Morning ice film', 1], ['GLADE', 'Forest opening', 2],
    ['GRAIN', 'Wheat unit', 1], ['GRAPE', 'Vine fruit', 1],
    ['HERON', 'Marsh-stalking bird', 2], ['HORSE', 'Trail mount', 1],
    ['HOUSE', 'Home building', 1], ['INLET', 'Narrow bay arm', 2],
    ['KAYAK', 'Paddled skin boat', 2], ['LEMON', 'Sour citrus', 1],
    ['LIGHT', 'Lamp\'s output', 1], ['LLAMA', 'Andean pack animal', 2],
    ['LODGE', 'Slope-side inn', 1], ['MAPLE', 'Syrup tree', 1],
    ['MARSH', 'Soggy wetland', 1], ['MOTOR', 'Engine', 1],
    ['MOUND', 'Small hill', 2], ['NORTH', 'Compass top', 1],
    ['OASIS', 'Desert refuge', 2], ['OTTER', 'Playful river swimmer', 1],
    ['OWLET', 'Baby hooter', 3], ['PIANO', 'Keyed instrument', 1],
    ['PILOT', 'Plane driver', 1], ['PLANT', 'Potted green', 1],
    ['PLAZA', 'Town square', 2],
    ['QUEST', 'Hero\'s mission', 1], ['RAVEN', 'Black croaker', 2],
    ['RIDGE', 'Mountain spine', 1], ['RIVER', 'Flowing water', 1],
    ['ROBIN', 'Red-breasted bird', 1], ['ROUTE', 'Travel path', 1],
    ['SCALE', 'Map ratio', 2], ['SHORE', 'Water\'s edge', 1],
    ['SKIER', 'Slope rider', 1], ['SLOPE', 'Hillside', 1],
    ['SOUTH', 'Compass bottom', 1], ['SPIRE', 'Tower peak', 2],
    ['STONE', 'Pebble\'s big kin', 1], ['STORM', 'Tempest', 1],
    ['STOVE', 'Camp cooker', 1], ['TRAIL', 'Hiking path', 1],
    ['TRAIN', 'Rail traveler', 1], ['TULIP', 'Dutch bloom', 2],
    ['WAGON', 'Pulled cart', 1], ['WHEEL', 'Round roller', 1],
    ['WORLD', 'Atlas subject', 1],
  ],
  6: [
    ['ALPINE', 'Of high mountain meadows', 3], ['ANCHOR', 'Ship\'s stopper', 1],
    ['BADGER', 'Burrowing mammal', 2], ['BASKET', 'Woven carrier', 1],
    ['BEACON', 'Guiding light', 2], ['BEAVER', 'Dam builder', 1],
    ['BRANCH', 'Tree limb', 1], ['BRIDGE', 'River span', 1],
    ['CANYON', 'Deep gorge', 1], ['CARPET', 'Floor cover', 1],
    ['CASTLE', 'Fortified home', 1], ['CIPHER', 'Secret code', 3],
    ['CIRCLE', 'Round shape', 1],
    ['CRATER', 'Volcano\'s mouth', 2], ['DESERT', 'Sandy expanse', 1],
    ['DONKEY', 'Sure-footed pack animal', 1], ['FOREST', 'Tree expanse', 1],
    ['GARDEN', 'Flower plot', 1], ['GEYSER', 'Steam spouter', 2],
    ['GOBLET', 'Fancy cup', 2], ['HARBOR', 'Ship shelter', 1],
    ['HELMET', 'Head guard', 1], ['ISLAND', 'Water-ringed land', 1],
    ['JUNGLE', 'Dense tropics', 1], ['LAGOON', 'Shallow pool', 2],
    ['MAGNET', 'Fridge sticker\'s secret', 2], ['MEADOW', 'Grassy field', 1],
    ['MONKEY', 'Tree swinger', 1], ['MUSEUM', 'Artifact home', 1],
    ['NARROW', 'Not wide', 1], ['NUGGET', 'Gold lump', 2],
    ['OYSTER', 'Pearl maker', 2], ['PALACE', 'Royal home', 1],
    ['PARROT', 'Talking bird', 1], ['PENCIL', 'Sketch tool', 1],
    ['PLANET', 'Orbiting world', 1], ['POCKET', 'Pants pouch', 1],
    ['PUFFIN', 'Clown-faced seabird', 3], ['PUZZLE', 'This grid, for one', 1],
    ['RABBIT', 'Burrow hopper', 1], ['RAPIDS', 'Whitewater stretch', 2],
    ['ROCKET', 'Space lifter', 1], ['SADDLE', 'Rider\'s seat', 1],
    ['SALMON', 'Upstream swimmer', 2], ['SHADOW', 'Sun blocker', 1],
    ['SIGNAL', 'Flag message, perhaps', 1], ['SPHERE', 'Ball shape', 2],
    ['SPRING', 'Natural water source', 1], ['STREAM', 'Flowing brook', 1],
    ['SUMMIT', 'Mountain top', 1], ['SUNSET', 'Evening sky show', 1],
    ['TEMPLE', 'Ancient shrine', 1], ['TUNNEL', 'Mountain passage', 1],
    ['TURTLE', 'Shell carrier', 1], ['VALLEY', 'Between hills', 1],
    ['VOYAGE', 'Long journey', 2], ['WALNUT', 'Hard-shelled nut', 2],
    ['WALRUS', 'Tusked swimmer', 2], ['WINDOW', 'Pane frame', 1],
    ['WINTER', 'Snowy season', 1],
  ],
  7: [
    ['AIRSHIP', 'Powered dirigible', 2], ['BALLOON', 'Hot-air ride', 2],
    ['BICYCLE', 'Two-wheeler', 1], ['BUFFALO', 'Plains grazer', 2],
    ['CABOOSE', 'Train\'s last car', 2], ['CARAVAN', 'Desert convoy', 2],
    ['CHANNEL', 'Water passage', 1], ['CHARIOT', 'Ancient racer', 3],
    ['COMPASS', 'Direction finder', 1],
    ['COTTAGE', 'Cozy country home', 1], ['COURIER', 'Message carrier', 2],
    ['DOLPHIN', 'Playful porpoise', 1], ['GATEWAY', 'Entrance arch', 2],
    ['GLACIER', 'River of ice', 2], ['GRANITE', 'Hard speckled rock', 2],
    ['HAMMOCK', 'Strung nap spot', 1], ['HORIZON', 'Sky\'s edge', 1],
    ['JOURNAL', 'Travel diary', 1], ['JOURNEY', 'Long trip', 1],
    ['LANTERN', 'Camp light', 1], ['MORNING', 'Dawn hours', 1],
    ['NARWHAL', 'Tusked whale', 3], ['OCTAGON', 'Eight-sided shape', 2],
    ['ORCHARD', 'Fruit-tree grove', 1], ['OUTLOOK', 'Scenic viewpoint', 2],
    ['PASSAGE', 'Way through', 1], ['PENGUIN', 'Tuxedoed bird', 1],
    ['PILGRIM', 'Journeying devotee', 2], ['RAILWAY', 'Train network', 1],
    ['RAINBOW', 'Post-storm arc', 1], ['SEAGULL', 'Chip thief', 1],
    ['SEASIDE', 'Coastal area', 1], ['SEXTANT', 'Navigator\'s tool', 3],
    ['SKYLINE', 'City silhouette', 1], ['STATION', 'Train stop', 1],
    ['TERRACE', 'Stepped patio', 2], ['VOLCANO', 'Lava mountain', 1],
    ['VOYAGER', 'Far traveler', 2], ['WAYSIDE', 'Road\'s edge', 2],
    ['WESTERN', 'Of the sunset\'s side', 2],
  ],
  8: [
    ['BASECAMP', 'Expedition home', 2], ['BLUEBIRD', 'Azure songster', 2],
    ['FIRESIDE', 'Hearth area', 1], ['FOOTHILL', 'Mountain\'s foot', 2],
    ['FOOTPATH', 'Walking track', 1], ['FORTRESS', 'Stronghold', 2],
    ['HIGHLAND', 'Elevated region', 2], ['LANDMARK', 'Notable sight', 1],
    ['LATITUDE', 'North-south measure', 3], ['MOUNTAIN', 'High peak', 1],
    ['NOTEBOOK', 'Jotting pad', 1], ['OVERLAND', 'By ground route', 2],
    ['PASSPORT', 'Border booklet', 1], ['PINEWOOD', 'Conifer forest', 2],
    ['SAILBOAT', 'Wind-powered craft', 1], ['SANDDUNE', 'Desert hill', 2],
    ['SEASHELL', 'Beach find', 1], ['SOUTHERN', 'Of the compass bottom', 2],
    ['SUITCASE', 'Travel bag', 1], ['TRAILMAP', 'Hiker\'s guide', 2],
    ['WAYFARER', 'Wandering traveler', 3], ['WAYPOINT', 'Route marker', 2],
    ['WINDMILL', 'Turning grain grinder', 1], ['WOODLAND', 'Forest tract', 1],
  ],
};

// word -> { w, c (clue), d (difficulty) }
export const BANK_INDEX = new Map();
export const BANK_BY_LEN = new Map(); // len -> entries[]
for (const [lenStr, list] of Object.entries(WORD_BANK)) {
  const len = Number(lenStr);
  const entries = list.map(([w, c, d]) => ({ w, c, d }));
  BANK_BY_LEN.set(len, entries);
  for (const e of entries) BANK_INDEX.set(e.w, e);
}
export const WORD_SET = new Set(BANK_INDEX.keys());

export function wordsOfLength(len, maxDifficulty = 3) {
  return (BANK_BY_LEN.get(len) || []).filter((e) => e.d <= maxDifficulty);
}

// ---------------------------------------------------------------------------
// Grid patterns. '.' = letter cell, '#' = void. Slots are maximal across/down
// runs of length >= 3; every letter cell must belong to at least one slot
// (enforced by the validators).
// ---------------------------------------------------------------------------

export const PATTERNS = {
  // Masks are sparse on purpose: the authored word bank (see WORD_BANK) has
  // limited letter-per-position coverage per length, so dense full-crossing
  // grids are provably unfillable. These layouts were verified fillable by
  // the validators at every difficulty tier that uses them.
  quay5: {
    name: 'Quay', size: 5,
    mask: [
      '##...',
      '.#.#.',
      '.....',
      '.#.#.',
      '...##',
    ],
  },
  open5: {
    name: 'Open Page', size: 5,
    mask: [
      '....#',
      '....#',
      '.###.',
      '#....',
      '#....',
    ],
  },
  harbor6: {
    name: 'Harbor', size: 6,
    mask: [
      '#.....',
      '#.#...',
      '#.##..',
      '..##.#',
      '...#.#',
      '.....#',
    ],
  },
  vale6: {
    name: 'Vale', size: 6,
    mask: [
      '....##',
      '.#.#..',
      '...#..',
      '..#...',
      '..#.#.',
      '##....',
    ],
  },
  trail7: {
    name: 'Trail', size: 7,
    mask: [
      '#...#..',
      '.#.#...',
      '.#.....',
      '..#.#..',
      '.....#.',
      '...#.#.',
      '..#...#',
    ],
  },
  meadow7: {
    name: 'Meadow', size: 7,
    mask: [
      '#....#.',
      '#.#....',
      '..#....',
      '.#.#.#.',
      '....#..',
      '....#.#',
      '.#....#',
    ],
  },
  vista8: {
    name: 'Vista', size: 8,
    mask: [
      '....##..',
      '..##....',
      '....#...',
      '.#...#.#',
      '#.#...#.',
      '...#....',
      '....##..',
      '..##....',
    ],
  },
  summit9: {
    name: 'Summit', size: 9,
    mask: [
      '.#..##...',
      '.....##.#',
      '.#..#....',
      '......##.',
      '.#.###.#.',
      '.##......',
      '....#..#.',
      '#.##.....',
      '...##..#.',
    ],
  },
};

export const MIN_SLOT = 3;

// slots: [{ dir, row, col, len, cells:[idx] }], row-major order, across first.
export function slotsForMask(mask) {
  const rows = mask.length;
  const cols = mask[0].length;
  const filled = (r, c) => mask[r][c] === '.';
  const slots = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (filled(r, c) && (c === 0 || !filled(r, c - 1))) {
        let len = 0;
        while (c + len < cols && filled(r, c + len)) len++;
        if (len >= MIN_SLOT) {
          slots.push({
            dir: 'across', row: r, col: c, len,
            cells: Array.from({ length: len }, (_, k) => r * cols + c + k),
          });
        }
        c += len;
      } else c++;
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (filled(r, c) && (r === 0 || !filled(r - 1, c))) {
        let len = 0;
        while (r + len < rows && filled(r + len, c)) len++;
        if (len >= MIN_SLOT) {
          slots.push({
            dir: 'down', row: r, col: c, len,
            cells: Array.from({ length: len }, (_, k) => (r + k) * cols + c),
          });
        }
        r += len;
      } else r++;
    }
  }
  return { rows, cols, slots };
}

// Every letter cell must be covered by at least one slot.
export function maskCoverage(mask) {
  const { rows, cols, slots } = slotsForMask(mask);
  const covered = new Set();
  for (const s of slots) for (const i of s.cells) covered.add(i);
  const uncovered = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (mask[r][c] === '.' && !covered.has(r * cols + c)) uncovered.push([r, c]);
    }
  }
  return { rows, cols, slots, uncovered };
}

// ---------------------------------------------------------------------------
// Seeded fill generator: backtracking with MRV over the word bank.
// ---------------------------------------------------------------------------

function tryFill(stream, rows, cols, slots, maxDifficulty) {
  const letters = new Array(rows * cols).fill(null);
  const ownerCount = new Array(rows * cols).fill(0);
  const used = new Set();
  const cand = slots.map((s) =>
    stream.shuffle(wordsOfLength(s.len, maxDifficulty).slice()));
  const assign = new Array(slots.length).fill(-1);

  const consistent = (si, wi) => {
    const w = cand[si][wi].w;
    const s = slots[si];
    for (let k = 0; k < s.len; k++) {
      const L = letters[s.cells[k]];
      if (L !== null && L !== w[k]) return false;
    }
    return true;
  };
  const place = (si, wi, delta) => {
    const w = cand[si][wi].w;
    const s = slots[si];
    for (let k = 0; k < s.len; k++) {
      const idx = s.cells[k];
      ownerCount[idx] += delta;
      if (delta > 0) letters[idx] = w[k];
      else if (ownerCount[idx] === 0) letters[idx] = null;
    }
  };

  function dfs() {
    let best = -1;
    let bestFeas = null;
    for (let si = 0; si < slots.length; si++) {
      if (assign[si] >= 0) continue;
      const feas = [];
      for (let wi = 0; wi < cand[si].length; wi++) {
        const w = cand[si][wi].w;
        if (!used.has(w) && consistent(si, wi)) feas.push(wi);
      }
      if (feas.length === 0) return false;
      if (bestFeas === null || feas.length < bestFeas.length) {
        best = si;
        bestFeas = feas;
        if (feas.length === 1) break;
      }
    }
    if (best < 0) return true; // all slots assigned
    for (const wi of bestFeas) {
      const w = cand[best][wi].w;
      assign[best] = wi;
      used.add(w);
      place(best, wi, +1);
      if (dfs()) return true;
      place(best, wi, -1);
      used.delete(w);
      assign[best] = -1;
    }
    return false;
  }

  if (!dfs()) return null;
  return slots.map((s, si) => ({ slot: s, entry: cand[si][assign[si]] }));
}

// Returns { rows, cols, cells: ['A'|null...], entries: [...] } or throws.
export function generateGrid(seed, { pattern, maxDifficulty = 3 } = {}) {
  const pat = PATTERNS[pattern];
  if (!pat) throw new Error(`unknown pattern ${pattern}`);
  const { rows, cols, slots } = slotsForMask(pat.mask);
  for (let attempt = 0; attempt < 32; attempt++) {
    const stream = createStream(`fill:${seed}:${attempt}`);
    const filled = tryFill(stream, rows, cols, slots, maxDifficulty);
    if (!filled) continue;

    // Standard crossword numbering: a cell is numbered when it starts an
    // across and/or a down slot; numbers increase in row-major order.
    const startsAcross = new Map();
    const startsDown = new Map();
    for (const { slot } of filled) {
      const m = slot.dir === 'across' ? startsAcross : startsDown;
      m.set(slot.cells[0], slot);
    }
    const cellNumber = new Map();
    let n = 0;
    for (let i = 0; i < rows * cols; i++) {
      if (startsAcross.has(i) || startsDown.has(i)) cellNumber.set(i, ++n);
    }
    const entries = filled.map(({ slot, entry }, i) => ({
      id: i,
      dir: slot.dir,
      row: slot.row,
      col: slot.col,
      len: slot.len,
      number: cellNumber.get(slot.cells[0]),
      clue: entry.c,
      word: entry.w,
      cells: slot.cells.slice(),
    }));
    const cells = new Array(rows * cols).fill(null);
    for (const { slot, entry } of filled) {
      for (let k = 0; k < slot.len; k++) cells[slot.cells[k]] = entry.w[k];
    }
    return { rows, cols, cells, entries };
  }
  throw new Error(`generateGrid: no fill found for seed ${seed} pattern ${pattern}`);
}

// ---------------------------------------------------------------------------
// Defs: full round definitions (identifier, seed, initial state, goals,
// mechanics, par, theme) per content schema.
// ---------------------------------------------------------------------------

const PAR_BY_PATTERN = {
  quay5: 300, open5: 330, harbor6: 420, vale6: 450,
  trail7: 600, meadow7: 660, vista8: 780, summit9: 900,
}; // seconds

function makeDef(base) {
  const grid = generateGrid(base.seed, {
    pattern: base.pattern,
    maxDifficulty: base.maxDifficulty ?? 3,
  });
  const parSecs = base.parSecs ?? PAR_BY_PATTERN[base.pattern] ?? 600;
  return {
    v: CONTENT_VERSION,
    rulesV: 1,
    id: base.id,
    name: base.name,
    seed: base.seed,
    mode: base.mode,
    theme: base.theme,
    pattern: base.pattern,
    rows: grid.rows,
    cols: grid.cols,
    cells: grid.cells,
    entries: grid.entries,
    limits: base.limits || {},
    par: { timeMs: (base.parTimeScale ?? 1) * parSecs * 1000 },
    mult: base.mult ?? 1,
    mechanics: base.mechanics || ['letters', 'crossings'],
    assists: {
      undo: base.assists?.undo ?? true,
      hints: base.assists?.hints ?? true,
      checks: base.assists?.checks ?? true,
    },
    ranked: base.ranked ?? false,
    tutorial: base.tutorial || null,
    blurb: base.blurb || '',
  };
}

// --- Journey: 40 authored stages, five themes, mastery every eighth page ---

const JOURNEY_TITLES = [
  // Harbor Dawn
  'First Mooring', 'Gull Watch', 'Tide Ledger', 'Lantern Pier',
  'Salt and Canvas', 'Fog Signal', 'Harbor Master', 'Mastery: The Breakwater',
  // Pine Ridge
  'Switchbacks', 'Resin and Bark', 'Eagle Cairn', 'The Long Traverse',
  'Timberline', 'Cabin Lights', 'Ridge Runner', 'Mastery: The North Face',
  // Desert Meridian
  'First Dunes', 'Mirage Line', 'Caravan Rest', 'The Dry Crossing',
  'Sun Compass', 'Oasis Ledger', 'Sandstorm Watch', 'Mastery: The Empty Quarter',
  // Frost Lantern
  'First Frost', 'Lantern Kindled', 'Icefall Steps', 'The White Silence',
  'Aurora Watch', 'Glacier Gate', 'Winter Quarter', 'Mastery: The Polar Page',
  // Orchard Rail
  'Platform One', 'Blossom Siding', 'The Slow Local', 'Orchard Gate',
  'Cider Season', 'Night Freight', 'Terminus Hotel', 'Mastery: The Last Page',
];

const TIER_TABLE = [
  { patterns: ['quay5', 'open5'], d: 1, mechanics: ['letters', 'crossings'] },
  { patterns: ['harbor6', 'vale6'], d: 1, mechanics: ['letters', 'crossings', 'checks'] },
  { patterns: ['trail7', 'meadow7'], d: 2, mechanics: ['letters', 'crossings', 'checks', 'reveals'] },
  { patterns: ['meadow7', 'vista8'], d: 2, mechanics: ['letters', 'crossings', 'checks', 'reveals', 'streaks'] },
  { patterns: ['summit9', 'vista8'], d: 3, mechanics: ['letters', 'crossings', 'checks', 'reveals', 'streaks'] },
];

const defCache = new Map();

export function journeyStage(n) {
  if (n < 1 || n > 40) throw new Error(`journey stage out of range: ${n}`);
  const key = `journey-${n}`;
  if (defCache.has(key)) return defCache.get(key);
  const tier = Math.ceil(n / 8);
  const mastery = n % 8 === 0;
  const t = TIER_TABLE[tier - 1];
  const pattern = mastery ? t.patterns[t.patterns.length - 1] : t.patterns[(n - 1) % t.patterns.length];
  const def = makeDef({
    id: key,
    name: JOURNEY_TITLES[n - 1],
    seed: key,
    mode: 'journey',
    theme: THEMES[tier - 1].id,
    pattern,
    maxDifficulty: mastery ? Math.min(3, t.d + 1) : t.d,
    mult: mastery ? 1.5 : 1,
    mechanics: mastery ? [...t.mechanics, 'mastery'] : t.mechanics,
    blurb: mastery ? 'Mastery page: everything so far, combined.' : '',
  });
  defCache.set(key, def);
  return def;
}

export function journeyStages() {
  return Array.from({ length: 40 }, (_, i) => journeyStage(i + 1));
}

// --- Learn: interactive lessons over one small deterministic grid ----------

let learnCache = null;
export function learnDef() {
  if (learnCache) return learnCache;
  const def = makeDef({
    id: 'learn', name: 'First Page', seed: 'learn-quay', mode: 'learn',
    theme: 'harbor', pattern: 'quay5', maxDifficulty: 1,
    blurb: 'Interactive lessons: one rule at a time.',
  });
  const across = def.entries.find((e) => e.dir === 'across');
  def.tutorial = {
    steps: [
      {
        text: 'Welcome to your travel journal! Tap the highlighted square, then type any letter. Letters go in with your keyboard.',
        require: { type: 'any-letter' },
        focus: across.cells[0],
      },
      {
        text: `Now solve this clue to finish the word: ${across.number} Across — “${across.clue}”. Wrong letters can be retyped or cleared.`,
        require: { type: 'complete-entry', entry: across.id },
        focus: across.cells[0],
      },
      {
        text: 'Words cross! Letters you placed are shared with the crossing words. Complete any other word using those crossings.',
        require: { type: 'any-word' },
      },
      {
        text: 'Not sure about a letter? Use Check (C) to confirm correct letters and flag wrong ones. Checking costs a few points.',
        require: { type: 'any-check' },
      },
      {
        text: 'Really stuck? Reveal (H) writes one letter for you, at a small score cost.',
        require: { type: 'any-reveal' },
      },
      {
        text: 'Finish the page: fill every remaining square with the right letter.',
        require: { type: 'grid-complete' },
      },
    ],
  };
  learnCache = def;
  return def;
}

// --- Daily: one shared seed per UTC day ------------------------------------

// Defective days are marked excluded from ranking, never silently replaced.
export const DAILY_EXCLUDED = new Set();

const DAILY_TABLE = [
  { pattern: 'summit9', d: 3 }, // Sunday
  { pattern: 'quay5', d: 1 },   // Monday
  { pattern: 'harbor6', d: 1 }, // Tuesday
  { pattern: 'trail7', d: 2 },  // Wednesday
  { pattern: 'vale6', d: 2 },   // Thursday
  { pattern: 'meadow7', d: 2 }, // Friday
  { pattern: 'vista8', d: 3 },  // Saturday
];

export function dailyForDate(date) {
  const iso = date.toISOString().slice(0, 10);
  const id = `daily-${iso}`;
  if (defCache.has(id)) return defCache.get(id);
  const t = DAILY_TABLE[date.getUTCDay()];
  const def = makeDef({
    id, name: `Daily — ${iso}`, seed: id, mode: 'daily',
    theme: THEMES[hashSeed(`daily-theme:${iso}`) % THEMES.length].id,
    pattern: t.pattern, maxDifficulty: t.d,
    ranked: !DAILY_EXCLUDED.has(iso),
    assists: { undo: false, hints: true, checks: true },
    blurb: 'One shared grid per UTC day. Ranked.',
  });
  defCache.set(id, def);
  return def;
}

// --- Practice: selectable difficulty, unranked, undo on ---------------------

const PRACTICE_TABLE = {
  easy: { patterns: ['quay5', 'open5'], d: 1 },
  medium: { patterns: ['harbor6', 'vale6', 'trail7'], d: 2 },
  hard: { patterns: ['meadow7', 'vista8', 'summit9'], d: 3 },
};

export function practiceDef(difficulty = 'medium', seed = null) {
  const t = PRACTICE_TABLE[difficulty] || PRACTICE_TABLE.medium;
  const s = seed || `practice-${difficulty}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const pattern = t.patterns[hashSeed(s) % t.patterns.length];
  return makeDef({
    id: `practice-${difficulty}-${s}`, name: `Practice (${difficulty})`,
    seed: s, mode: 'practice',
    theme: THEMES[hashSeed(`${s}:theme`) % THEMES.length].id,
    pattern, maxDifficulty: t.d, ranked: false,
    assists: { undo: true, hints: true, checks: true },
    blurb: 'Unranked. Undo, hints and checks are all available.',
  });
}

// --- Challenge: constrained goals, ranked -----------------------------------

export const CHALLENGES = [
  {
    id: 'challenge-speed-ink', name: 'Speed Ink', pattern: 'trail7', d: 2,
    limits: { timeMs: 360000 }, mult: 1.5,
    blurb: 'Finish before the ink dries: 6 minutes on the clock.',
  },
  {
    id: 'challenge-no-eraser', name: 'No Eraser', pattern: 'harbor6', d: 2,
    limits: { mistakes: 3 }, mult: 1.5,
    blurb: 'Only 3 mistakes may be flagged before the page is ruined.',
  },
  {
    id: 'challenge-blind-corners', name: 'Blind Corners', pattern: 'meadow7', d: 2,
    limits: { checks: 2 }, mult: 1.5,
    blurb: 'Just 2 checks for the whole grid. Trust your crossings.',
  },
  {
    id: 'challenge-long-haul', name: 'Long Haul', pattern: 'vista8', d: 3,
    limits: {}, mult: 2,
    blurb: 'A grand vista of a grid. No limits — double points.',
  },
  {
    id: 'challenge-summit-push', name: 'Summit Push', pattern: 'summit9', d: 3,
    limits: { timeMs: 1500000, mistakes: 8 }, mult: 2,
    blurb: 'The hardest page: 25 minutes, 8 mistakes, double points.',
  },
];

export function challengeDef(id) {
  const spec = CHALLENGES.find((c) => c.id === id);
  if (!spec) throw new Error(`unknown challenge ${id}`);
  if (defCache.has(id)) return defCache.get(id);
  const def = makeDef({
    id: spec.id, name: spec.name, seed: spec.id, mode: 'challenge',
    theme: THEMES[hashSeed(`${spec.id}:theme`) % THEMES.length].id,
    pattern: spec.pattern, maxDifficulty: spec.d,
    limits: spec.limits, mult: spec.mult, ranked: true,
    assists: { undo: false, hints: true, checks: true },
    blurb: spec.blurb,
  });
  defCache.set(id, def);
  return def;
}

export function challengeDefs() {
  return CHALLENGES.map((c) => challengeDef(c.id));
}

// ---------------------------------------------------------------------------
// Offline validators: legality, coverage, geometry, cluing, bounded duration.
// ---------------------------------------------------------------------------

export function validateDef(def) {
  const errors = [];
  if (!def.rows || !def.cols || def.cells.length !== def.rows * def.cols) {
    errors.push('cells-size');
  }
  const seen = new Set();
  for (const e of def.entries) {
    if (!WORD_SET.has(e.word)) errors.push(`unknown-word:${e.word}`);
    if (seen.has(e.word)) errors.push(`duplicate-word:${e.word}`);
    seen.add(e.word);
    if (e.cells.length !== e.len || e.word.length !== e.len) errors.push(`entry-len:${e.word}`);
    const bank = BANK_INDEX.get(e.word);
    if (bank && bank.c !== e.clue) errors.push(`clue-mismatch:${e.word}`);
    for (let k = 0; k < e.len; k++) {
      const expect = e.dir === 'across'
        ? e.row * def.cols + e.col + k
        : (e.row + k) * def.cols + e.col;
      if (e.cells[k] !== expect) errors.push(`entry-geometry:${e.word}`);
      if (def.cells[e.cells[k]] !== e.word[k]) errors.push(`entry-letter:${e.word}`);
    }
  }
  const covered = new Set();
  for (const e of def.entries) for (const i of e.cells) covered.add(i);
  def.cells.forEach((c, i) => {
    if (c !== null && !covered.has(i)) errors.push(`uncovered-cell:${i}`);
    if (c === null && covered.has(i)) errors.push(`entry-over-void:${i}`);
  });
  const startNumbers = new Map();
  for (const e of def.entries) {
    const s = e.cells[0];
    if (!startNumbers.has(s)) startNumbers.set(s, new Set());
    startNumbers.get(s).add(e.number);
  }
  for (const [s, nums] of startNumbers) {
    if (nums.size !== 1) errors.push(`number-mismatch:${s}`);
  }
  if (!(def.par?.timeMs > 0)) errors.push('bad-par');
  return errors;
}

export function validateAll() {
  const out = {};
  for (const s of journeyStages()) out[s.id] = validateDef(s);
  out.learn = validateDef(learnDef());
  for (const c of challengeDefs()) out[c.id] = validateDef(c);
  return out;
}
