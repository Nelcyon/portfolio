// Every project shown on the site and in the cul-de-sac world.
// Edit this one file to change descriptions, links, status or screenshots.
//
// status.kind: "beta" | "playable" | "dev" | "concept" | "mod"
// links[].kind: "play" | "download" | "buy" | "source" | "site"

export const OWNER = {
  name: 'Nelcyon',
  role: 'Independent developer',
  blurb:
    'I build accessible tools and small games: communication software for people with ALS, ' +
    'games you can play with a mouth-operated joystick, and card and strategy games for the whole family.',
  github: 'https://github.com/Nelcyon',
};

export const PROJECTS = [
  {
    id: 'bettertalk',
    name: 'BetterTalk',
    tagline: 'A free speech app for people with ALS who use a QuadStick, switch or eye tracker.',
    status: { kind: 'beta', label: 'Early beta' },
    platforms: ['Windows 10/11'],
    tags: ['Accessibility', 'AAC', 'C# / .NET', 'Open source'],
    accent: '#e8b400',
    icon: '💬',
    cover: 'assets/shots/bettertalk-main.png',
    description: [
      'BetterTalk is a free, open-source communication app (AAC) for people living with ALS and other conditions that affect speech. ' +
        'The user builds a message on a large on-screen keyboard with word suggestions that learn from them, or picks a stored phrase, and the app says it out loud.',
      'It is designed to sit small in the corner of the screen while the person does whatever else they are doing, such as watching a show or playing a game, ' +
        'and it speaks with natural-sounding voices that run entirely offline.',
    ],
    highlights: [
      'Urgent buttons (Help, bathroom, pain, yes, no) always one press away',
      'Point to exactly where you itch on a 3D body figure',
      'Works with a QuadStick, head or mouth switch, mouse, or an eye tracker',
      'Offline voices (Piper, Kokoro) and Windows voices; nothing is sent online',
    ],
    timeline: [
      { date: 'Oct 2026', title: 'QuadStick Talk prototype (v0.1)', text: 'First prototype built around one person with advanced ALS: quick responses, keyboard, phrases and approve-then-speak.' },
      { date: 'Oct 2026', title: 'BetterTalk public beta (0.3)', text: 'Renamed, open-sourced, and given an installer and a simple download page.' },
      { date: 'Oct 2026', title: 'Version 0.4.5', text: 'Its own icon, a "Last said" key, and cleaner audio so the last word is never cut short.' },
    ],
    links: [
      { kind: 'download', label: 'Download for Windows', url: 'https://github.com/Nelcyon/bettertalkopen/releases/latest/download/BetterTalk-Setup.exe' },
      { kind: 'site', label: 'Download page', url: 'https://bettertalkopen.pages.dev' },
      { kind: 'source', label: 'Source code', url: 'https://github.com/Nelcyon/bettertalkopen' },
    ],
    gallery: [
      { src: 'assets/shots/bettertalk-main.png', caption: 'The main window: urgent buttons, word suggestions and keyboard', kind: 'desktop' },
      { src: 'assets/shots/bettertalk-itch.jpg', caption: 'Point to where it itches on a 3D figure', kind: 'desktop' },
    ],
    world: 'Downstairs in the house by the bus stop, docked in the corner of a 40" monitor in front of a wheelchair user.',
  },
  {
    id: 'rubecube',
    name: 'RubeCube',
    tagline: "An accessible 3D Rubik's cube you can play with a mouth-operated joystick.",
    status: { kind: 'playable', label: 'Playable now' },
    platforms: ['Browser', 'Phone', 'Desktop'],
    tags: ['Accessibility', 'Game', 'Three.js', 'Open source'],
    accent: '#3b82f6',
    icon: '🧊',
    cover: 'assets/shots/rubecube-desktop.jpg',
    description: [
      "RubeCube is a 3D Rubik's cube built for playing with a QuadStick (a mouth-operated joystick with sip-and-puff switches). " +
        'Every layer has its own large button right against the edge it turns, so nothing needs dragging, holding or pressing two things at once.',
      'It is one HTML file with nothing to install. Open it in any modern browser on a computer or a phone.',
    ],
    highlights: [
      'Left click turns a layer one way, right click the other way',
      'Every action can be remapped; a QuadStick preset matches the card in BetterTalk',
      'Color letters on the stickers for color blindness, adjustable text size and turn speed',
      'Saves your cube automatically; never times out',
    ],
    timeline: [
      { date: 'Oct 2026', title: 'First playable cube', text: 'One button per layer, placed against the edge it turns.' },
      { date: 'Oct 2026', title: 'Keybinds and the QuadStick card', text: 'Any key or mouse button for any action, with a preset matching BetterTalk.' },
      { date: 'Oct 2026', title: 'Algorithms and Challenge modes', text: 'Guided solving and a challenge mode.' },
    ],
    links: [
      { kind: 'play', label: 'Play in your browser', url: 'https://nelcyon.github.io/rubecube/' },
      { kind: 'source', label: 'Source code', url: 'https://github.com/Nelcyon/rubecube' },
    ],
    gallery: [
      { src: 'assets/shots/rubecube-desktop.jpg', caption: 'On a desktop monitor', kind: 'desktop' },
      { src: 'assets/shots/rubecube-phone.jpg', caption: 'On a phone', kind: 'phone' },
    ],
    world: 'On the 40" monitor downstairs in the house by the bus stop, with BetterTalk in the corner.',
  },
  {
    id: 'roadway-rivals',
    name: 'Roadway Rivals',
    aka: 'Freedom Road',  // working title in the 1000miles repo
    tagline: 'Race a rival coast to coast in a road-trip card game.',
    status: { kind: 'dev', label: 'In development' },
    platforms: ['Phone', 'PC', 'Web browser'],
    tags: ['Game', 'Card game', 'React Native / Expo'],
    accent: '#d62839',
    icon: '🚗',
    cover: 'assets/shots/roadway-phone.jpg',
    description: [
      'A coast-to-coast American road trip in a card game. Race a rival from Boston Harbor to the Golden Gate: play mileage cards to cover 1000 miles, ' +
        'throw Fender Benders, Blowouts and Speed Traps at your rival, and fix your own with Tow Trucks, Spare Tires and Green Lights.',
      'It runs on phones, as a PC app, and in a web browser on any computer.',
    ],
    highlights: [
      'Original road-trip theme and card art',
      'Hazards, fixes and perks (Stunt Driver, Bottomless Tank, Freedom Pass)',
      'Play against Dusty, the computer rival',
      'One codebase for phone and desktop',
    ],
    timeline: [
      { date: 'Oct 2026', title: 'Rules engine and computer rival', text: 'Full deck, hazards, fixes, perks and an AI opponent.' },
      { date: 'Oct 2026', title: 'Phone UI', text: 'Route bar, battle and speed piles, and a hand of illustrated cards.' },
    ],
    links: [],
    gallery: [
      { src: 'assets/shots/roadway-title-phone.jpg', caption: 'Title screen', kind: 'phone' },
      { src: 'assets/shots/roadway-phone.jpg', caption: 'Racing Dusty through Monument Valley', kind: 'phone' },
      { src: 'assets/shots/roadway-desktop.jpg', caption: 'On a PC', kind: 'desktop' },
      { src: 'assets/shots/roadway-score-phone.jpg', caption: 'End-of-trip score', kind: 'phone' },
    ],
    world: 'On a phone at the bus stop, and on the computer of the kid upstairs, who is playing against the person at the bus stop.',
  },
  {
    id: 'bridge-defender',
    name: 'Bridge Defender',
    tagline: 'Hold the bridge against goblins, skeletons and demons in a turn-based phone game.',
    status: { kind: 'dev', label: 'In development' },
    platforms: ['Android', 'Vertical monitor'],
    tags: ['Game', 'Godot 4', 'Mobile'],
    accent: '#f28c28',
    icon: '🛡️',
    cover: 'assets/shots/bridge-defender-title.jpg',
    description: [
      'A portrait-mode (720×1280) phone game made in Godot. You defend a bridge turn by turn, choosing between three weapon cards to attack or block, ' +
        'merging gear, opening chests and collecting loot between battles in the Town.',
      'The world is a Town with four wings; each wing has four monster levels and a boss. The Forest wing is built, and the game also plays well on a monitor turned vertical.',
    ],
    highlights: [
      'Turn-based combat with weapon loadout cards',
      'Merges, loot tables, chests and per-level challenges',
      'Town hub with three save slots',
      'Bestiary of goblins, slimes, skeletons, demons and a Minotaur',
    ],
    timeline: [
      { date: 'Oct 2026', title: 'Project recovered from the Android build', text: 'The Godot project was rebuilt from the released APK.' },
      { date: 'Oct 2026', title: 'Full code audit', text: 'Every system checked; the Forest levels 1 to 4 chain together.' },
      { date: 'Next', title: 'Forest boss and UI redesign', text: 'Close the five-level Forest loop and redo the UI for more screen sizes.' },
    ],
    links: [],
    gallery: [{ src: 'assets/shots/bridge-defender-title.jpg', caption: 'Title art', kind: 'phone' }],
    world: 'On the vertical second monitor of the kid upstairs, and on a phone at the bus stop.',
  },
  {
    id: 'seraph',
    name: 'Seraph',
    tagline: 'A 2D isometric tactical action RPG.',
    status: { kind: 'concept', label: 'Coming soon' },
    platforms: ['Windows', 'Linux'],
    tags: ['Game', 'Godot 4', 'RPG'],
    accent: '#8b7cf6',
    icon: '🪽',
    cover: 'assets/shots/seraph-placeholder.jpg',
    placeholder: true,
    description: [
      'Seraph is a 2D-isometric tactical action RPG made in Godot. Fight with weapon sets and abilities, block, swap loadouts, and pray at shrines.',
      'Prototype builds exist for Windows and Linux; public downloads are coming soon.',
    ],
    highlights: [
      'WASD movement, attack and block on the mouse',
      'Five ability slots, two weapon sets, inventory and spellbook',
      'Shrines, view cones and a debug overlay',
    ],
    timeline: [{ date: 'Oct 2026', title: 'First prototype builds', text: 'Windows and Linux builds published with automatic releases.' }],
    links: [],
    gallery: [{ src: 'assets/shots/seraph-placeholder.jpg', caption: 'Placeholder image: a real screenshot is coming', kind: 'desktop' }],
    world: 'On the second kid’s computer upstairs, in the shared bedroom.',
  },
  {
    id: 'family-card-table',
    name: 'Family Card Table',
    tagline: 'Free, simple card games so the whole family can play and chat together, wherever they live.',
    status: { kind: 'playable', label: 'Playable now' },
    platforms: ['Phone', 'Tablet', 'Desktop browser'],
    tags: ['Game', 'Multiplayer', 'TypeScript', 'Cloudflare'],
    accent: '#16a34a',
    icon: '🃏',
    cover: 'assets/shots/fct-desktop.jpg',
    description: [
      'Spades, Euchre, Hearts, Cribbage, Gin Rummy, Canasta and more, plus solitaire, checkers and dice games. Computer players fill any empty seat, ' +
        'and a table chat with one-tap phrases keeps everyone talking.',
      'It is made for grandparents: big text, big buttons, high-contrast cards, one clear instruction at a time, and nothing happens on a stray tap. ' +
        'Families join with a name, four numbers and one shared family word.',
    ],
    highlights: [
      'Card, solitaire, tile and board games in one place',
      'Saved games wait up to 14 days for everyone to come back',
      'Big, clear, grandparent-friendly design',
      'Each family can host its own free copy on Cloudflare',
    ],
    timeline: [
      { date: 'Oct 2026', title: 'First tables', text: 'Spades with partners, seats and swapping, computer players.' },
      { date: 'Oct 2026', title: 'More games and saved games', text: 'Solitaire family, Checkers, Five Dice, and save-and-come-back.' },
      { date: 'Oct 2026', title: 'One-click hosting', text: 'Runs free on Cloudflare Workers for each family.' },
    ],
    links: [{ kind: 'play', label: 'Open the card room', url: 'https://family-card-table.familygames.workers.dev' }],
    gallery: [
      { src: 'assets/shots/fct-desktop.jpg', caption: 'Hearts on a computer, with table chat', kind: 'desktop' },
      { src: 'assets/shots/fct-phone.jpg', caption: 'Hearts on a phone', kind: 'phone' },
    ],
    world: 'In the house next door: Grandma plays on a laptop at the kitchen table, and Grandpa is in the same game on his phone on the porch swing.',
  },
];

export const STATUS_LABEL = {
  beta: 'Early beta',
  playable: 'Playable now',
  dev: 'In development',
  concept: 'Coming soon',
  mod: 'Game mod',
};

export function projectById(id) {
  return PROJECTS.find((p) => p.id === id);
}
