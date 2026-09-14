export type ItemMotif =
  | 'potion' | 'orb' | 'ration' | 'eye' | 'dust' | 'seed' | 'shard' | 'rune'
  | 'blade' | 'spark' | 'shield' | 'grip' | 'cord' | 'bark' | 'leaf' | 'crystal'
  | 'reed' | 'amulet' | 'thread' | 'ring' | 'mace' | 'lens' | 'gear' | 'boots'
  | 'heart' | 'stone' | 'well' | 'sigil' | 'mantle' | 'crest' | 'greaves' | 'crown'
  | 'twinblade' | 'staff' | 'oath' | 'executioner' | 'coil' | 'prism' | 'bulwark'
  | 'relic' | 'solar' | 'ascendant' | 'cataclysm' | 'oracle' | 'immortal' | 'rift';

export type ItemVisualSpec = Readonly<{
  motif: ItemMotif;
  primary: string;
  secondary: string;
  glow: string;
  seed: number;
}>;

const ITEM_VISUALS: Record<string, ItemVisualSpec> = {
  item_001:{motif:'potion',primary:'#c65f43',secondary:'#f1b36d',glow:'#ff7a50',seed:1},
  item_002:{motif:'potion',primary:'#397ec9',secondary:'#8ed5ff',glow:'#5bb8ff',seed:2},
  item_003:{motif:'ration',primary:'#956d43',secondary:'#d9bd78',glow:'#f4d68a',seed:3},
  item_004:{motif:'eye',primary:'#4f8fa6',secondary:'#c7efff',glow:'#6edbff',seed:4},
  item_005:{motif:'dust',primary:'#9d78b8',secondary:'#e2c4ff',glow:'#c795ff',seed:5},
  item_006:{motif:'potion',primary:'#447b63',secondary:'#8ee5bc',glow:'#5ff2b4',seed:6},
  item_007:{motif:'seed',primary:'#6f786e',secondary:'#b6c4ad',glow:'#92c78c',seed:7},
  item_008:{motif:'shard',primary:'#5d9eae',secondary:'#b9f3ff',glow:'#78e6ff',seed:8},
  item_009:{motif:'rune',primary:'#6658a7',secondary:'#c8bbff',glow:'#a58cff',seed:9},
  item_010:{motif:'blade',primary:'#737c84',secondary:'#e2e8e8',glow:'#c8e2ee',seed:10},
  item_011:{motif:'spark',primary:'#6d4bc1',secondary:'#ddb8ff',glow:'#bd75ff',seed:11},
  item_012:{motif:'shield',primary:'#69747a',secondary:'#c9d1cd',glow:'#8bbcc8',seed:12},
  item_013:{motif:'grip',primary:'#8a6049',secondary:'#d7a978',glow:'#f0be7e',seed:13},
  item_014:{motif:'cord',primary:'#6d5539',secondary:'#d7c18a',glow:'#d9c675',seed:14},
  item_015:{motif:'bark',primary:'#6a5037',secondary:'#a98558',glow:'#78be6d',seed:15},
  item_016:{motif:'leaf',primary:'#4d8353',secondary:'#a9df83',glow:'#7de86f',seed:16},
  item_017:{motif:'crystal',primary:'#3970b8',secondary:'#9edcff',glow:'#58b8ff',seed:17},
  item_018:{motif:'reed',primary:'#6f8654',secondary:'#d6d59a',glow:'#b9d977',seed:18},
  item_019:{motif:'amulet',primary:'#6d667c',secondary:'#e1c37d',glow:'#7dd9e7',seed:19},
  item_020:{motif:'thread',primary:'#4e5d7c',secondary:'#b6c1e5',glow:'#849cff',seed:20},
  item_021:{motif:'ring',primary:'#80543e',secondary:'#d8a566',glow:'#efb66d',seed:21},
  item_022:{motif:'ring',primary:'#3f7180',secondary:'#86d7de',glow:'#5fe8ef',seed:22},
  item_023:{motif:'ring',primary:'#5e4d91',secondary:'#c5a7ec',glow:'#bd85ff',seed:23},
  item_024:{motif:'mace',primary:'#72777b',secondary:'#d4d7cf',glow:'#e5bd70',seed:24},
  item_025:{motif:'lens',primary:'#644a9f',secondary:'#cab8f0',glow:'#b887ff',seed:25},
  item_026:{motif:'shield',primary:'#59646a',secondary:'#bac8c9',glow:'#7ec2d2',seed:26},
  item_027:{motif:'gear',primary:'#556b72',secondary:'#d5b66d',glow:'#7ed7df',seed:27},
  item_028:{motif:'boots',primary:'#5b473d',secondary:'#c7a574',glow:'#7ecde0',seed:28},
  item_029:{motif:'heart',primary:'#874d49',secondary:'#dca486',glow:'#ff8f7d',seed:29},
  item_030:{motif:'stone',primary:'#4f7568',secondary:'#9ec9ad',glow:'#78db9d',seed:30},
  item_031:{motif:'well',primary:'#384e83',secondary:'#87b8e6',glow:'#65a7ff',seed:31},
  item_032:{motif:'orb',primary:'#4f5a8a',secondary:'#b5bfe8',glow:'#8aa7ff',seed:32},
  item_033:{motif:'sigil',primary:'#625b68',secondary:'#d4bb7c',glow:'#83d8d6',seed:33},
  item_034:{motif:'mantle',primary:'#3c4a63',secondary:'#939fc6',glow:'#6e8ee8',seed:34},
  item_035:{motif:'crest',primary:'#6f665d',secondary:'#d8bd7a',glow:'#73d7e6',seed:35},
  item_036:{motif:'greaves',primary:'#3e5967',secondary:'#9fd6dd',glow:'#6de7f0',seed:36},
  item_037:{motif:'crown',primary:'#564785',secondary:'#ddb971',glow:'#b479ff',seed:37},
  item_038:{motif:'shield',primary:'#4f5960',secondary:'#d0b66f',glow:'#7acbe0',seed:38},
  item_039:{motif:'blade',primary:'#704a42',secondary:'#d7b37b',glow:'#df6f5e',seed:39},
  item_040:{motif:'twinblade',primary:'#436d7c',secondary:'#c2dfe2',glow:'#62dcec',seed:40},
  item_041:{motif:'staff',primary:'#744d3d',secondary:'#f0b965',glow:'#ff8054',seed:41},
  item_042:{motif:'boots',primary:'#5a4a43',secondary:'#d4b36c',glow:'#8de2e5',seed:42},
  item_043:{motif:'oath',primary:'#5e6663',secondary:'#d0b66c',glow:'#78cdd8',seed:43},
  item_044:{motif:'mantle',primary:'#2f344d',secondary:'#9588ba',glow:'#7a70ff',seed:44},
  item_045:{motif:'executioner',primary:'#5f3c38',secondary:'#d4c2a2',glow:'#ef5c50',seed:45},
  item_046:{motif:'coil',primary:'#344f65',secondary:'#c9ad68',glow:'#53d8ff',seed:46},
  item_047:{motif:'mace',primary:'#6b3837',secondary:'#b9946c',glow:'#f15e50',seed:47},
  item_048:{motif:'prism',primary:'#4f4685',secondary:'#d8c4f2',glow:'#ae7dff',seed:48},
  item_049:{motif:'bulwark',primary:'#5b605c',secondary:'#d7b96f',glow:'#70cde1',seed:49},
  item_050:{motif:'greaves',primary:'#3c4859',secondary:'#a9bad2',glow:'#6f91ff',seed:50},
  item_051:{motif:'relic',primary:'#5a526a',secondary:'#d8bc70',glow:'#79d8d7',seed:51},
  item_052:{motif:'solar',primary:'#7a523b',secondary:'#efc36a',glow:'#ff9c4e',seed:52},
  item_053:{motif:'ascendant',primary:'#4e5960',secondary:'#e1c26f',glow:'#8ce7f1',seed:53},
  item_054:{motif:'cataclysm',primary:'#573a3b',secondary:'#e0b26c',glow:'#ff5a4f',seed:54},
  item_055:{motif:'oracle',primary:'#44395f',secondary:'#caa86c',glow:'#b15cff',seed:55},
  item_056:{motif:'immortal',primary:'#4f5754',secondary:'#d3b672',glow:'#6dd3db',seed:56},
  item_057:{motif:'rift',primary:'#343b55',secondary:'#bda86b',glow:'#756dff',seed:57},
  item_058:{motif:'heart',primary:'#524a61',secondary:'#dfbd70',glow:'#7adcf0',seed:58},
};

const FALLBACK: ItemVisualSpec = { motif: 'relic', primary: '#46545a', secondary: '#c6a766', glow: '#78c7d9', seed: 0 };

function motifSvg(motif: ItemMotif, primary: string, secondary: string, glow: string) {
  const common = `fill="${primary}" stroke="${secondary}" stroke-width="4" stroke-linejoin="round"`;
  switch (motif) {
    case 'potion': return `<path ${common} d="M45 25h38v10l-7 8v12l14 29c5 11-3 20-15 20H53c-12 0-20-9-15-20l14-29V43l-7-8z"/><path fill="${glow}" opacity=".78" d="M45 76h38l8 18H37z"/>`;
    case 'ration': return `<path ${common} d="M33 43l31-20 31 20-8 47-23 14-23-14z"/><path fill="${glow}" d="M47 60h34v12H47z" opacity=".7"/>`;
    case 'eye': return `<path ${common} d="M17 65Q64 19 111 65Q64 111 17 65z"/><circle cx="64" cy="65" r="19" fill="${glow}"/><circle cx="64" cy="65" r="8" fill="#071013"/>`;
    case 'dust': return `<path ${common} d="M40 23h48l-8 24 17 50H31l17-50z"/><g fill="${glow}"><circle cx="49" cy="75" r="5"/><circle cx="66" cy="63" r="4"/><circle cx="80" cy="80" r="6"/></g>`;
    case 'seed': return `<path ${common} d="M64 18c29 18 36 53 7 89-35-12-45-54-7-89z"/><path d="M64 31v60" stroke="${glow}" stroke-width="5"/>`;
    case 'shard': case 'crystal': return `<path ${common} d="M64 14l29 33-16 65H50L35 47z"/><path fill="${glow}" opacity=".62" d="M64 23v78L43 49z"/>`;
    case 'rune': return `<path ${common} d="M29 29l35-13 35 13 13 35-13 35-35 13-35-13-13-35z"/><path d="M43 87l22-48 20 48M53 68h22" fill="none" stroke="${glow}" stroke-width="6"/>`;
    case 'blade': case 'executioner': case 'cataclysm': return `<path ${common} d="M68 12l18 13-8 56-14 30-10-32z"/><path fill="${secondary}" d="M42 82h44v9H42z"/><path fill="${glow}" opacity=".7" d="M68 20l8 9-9 47-7-2z"/>`;
    case 'spark': return `<path ${common} d="M71 12L39 65h22l-7 51 36-62H68z"/><path fill="${glow}" d="M66 24L49 58h18l-4 30 18-31H65z"/>`;
    case 'shield': case 'bulwark': case 'immortal': return `<path ${common} d="M64 14l39 16v31c0 27-15 43-39 55-24-12-39-28-39-55V30z"/><path d="M64 28v67M39 54h50" stroke="${glow}" stroke-width="5" opacity=".75"/>`;
    case 'grip': case 'cord': case 'thread': return `<path d="M38 20c33 17 18 39 48 52 18 8 15 29-2 37" fill="none" stroke="${secondary}" stroke-width="11" stroke-linecap="round"/><path d="M38 20c33 17 18 39 48 52" fill="none" stroke="${glow}" stroke-width="3"/>`;
    case 'bark': return `<path ${common} d="M41 17h46l10 90H31z"/><path d="M53 25l-9 71M72 22l7 78" stroke="${glow}" stroke-width="4" opacity=".55"/>`;
    case 'leaf': case 'reed': return `<path ${common} d="M103 21C56 22 27 48 28 97c38 4 67-22 75-76z"/><path d="M36 91L89 36" stroke="${glow}" stroke-width="5"/>`;
    case 'amulet': case 'sigil': case 'relic': case 'ascendant': return `<circle cx="64" cy="66" r="38" ${common}/><path d="M64 24l15 29 31 5-23 23 6 31-29-15-29 15 6-31-23-23 31-5z" fill="${glow}" opacity=".66"/>`;
    case 'ring': return `<circle cx="64" cy="64" r="42" fill="none" stroke="${secondary}" stroke-width="15"/><circle cx="64" cy="64" r="25" fill="none" stroke="${glow}" stroke-width="5" opacity=".75"/>`;
    case 'mace': return `<path d="M60 54l12 8-30 48-12-8z" fill="${secondary}"/><path ${common} d="M57 18l31 6 9 29-22 20-31-8-8-29z"/><circle cx="67" cy="45" r="11" fill="${glow}" opacity=".7"/>`;
    case 'lens': case 'orb': case 'well': case 'prism': case 'oracle': return `<circle cx="64" cy="64" r="38" ${common}/><circle cx="64" cy="64" r="24" fill="${glow}" opacity=".58"/><path d="M64 25l20 39-20 39-20-39z" fill="none" stroke="${secondary}" stroke-width="5"/>`;
    case 'gear': case 'coil': return `<circle cx="64" cy="64" r="34" fill="none" stroke="${secondary}" stroke-width="12" stroke-dasharray="10 7"/><circle cx="64" cy="64" r="18" fill="${primary}" stroke="${glow}" stroke-width="5"/>`;
    case 'boots': case 'greaves': case 'rift': return `<path ${common} d="M45 18h29v45c5 11 17 17 31 20v22H40c-12 0-19-8-16-19l13-34z"/><path d="M45 79h49" stroke="${glow}" stroke-width="6"/>`;
    case 'heart': case 'solar': return `<path ${common} d="M64 111C21 84 18 49 37 32c14-12 29-5 27 10 2-15 18-22 31-10 19 17 16 52-31 79z"/><circle cx="64" cy="61" r="17" fill="${glow}" opacity=".7"/>`;
    case 'stone': return `<path ${common} d="M31 42l21-24 35 6 18 28-11 42-32 19-31-18-8-30z"/><path d="M43 67l17-19 24 7" fill="none" stroke="${glow}" stroke-width="5"/>`;
    case 'mantle': return `<path ${common} d="M30 25l34-11 34 11-12 26 10 60-32-15-32 15 10-60z"/><path d="M64 24v65" stroke="${glow}" stroke-width="5" opacity=".65"/>`;
    case 'crest': case 'crown': return `<path ${common} d="M27 89l7-57 24 22 7-36 16 36 25-22-4 57z"/><path d="M34 88h68" stroke="${glow}" stroke-width="7"/>`;
    case 'twinblade': return `<path ${common} d="M43 15l15 12-10 62-17 22 3-30z"/><path ${common} d="M85 15L70 27l10 62 17 22-3-30z"/><circle cx="64" cy="74" r="12" fill="${glow}"/>`;
    case 'staff': return `<path d="M61 38h8v76h-8z" fill="${secondary}"/><circle cx="65" cy="29" r="20" ${common}/><circle cx="65" cy="29" r="10" fill="${glow}"/>`;
    case 'oath': return `<path ${common} d="M31 22h66v78H31z"/><path d="M44 42h40M44 58h31M44 74h36" stroke="${glow}" stroke-width="5"/><path fill="${secondary}" d="M79 84l13 23 12-23z"/>`;
  }
}

export function getItemVisualSpec(itemId: string): ItemVisualSpec {
  return ITEM_VISUALS[itemId] ?? FALLBACK;
}

export function getItemIconSvg(itemId: string) {
  const spec = getItemVisualSpec(itemId);
  const rotation = ((spec.seed * 13) % 15) - 7;
  const rune = 18 + (spec.seed % 5) * 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <radialGradient id="bg" cx="38%" cy="28%" r="78%"><stop stop-color="${spec.primary}"/><stop offset="1" stop-color="#071014"/></radialGradient>
      <filter id="g"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <rect x="3" y="3" width="122" height="122" rx="18" fill="url(#bg)" stroke="${spec.secondary}" stroke-width="4"/>
    <circle cx="64" cy="64" r="46" fill="none" stroke="${spec.glow}" stroke-width="2" opacity=".24" stroke-dasharray="${rune} 9" transform="rotate(${spec.seed * 9} 64 64)"/>
    <circle cx="64" cy="64" r="37" fill="${spec.glow}" opacity=".10" filter="url(#g)"/>
    <g transform="rotate(${rotation} 64 64) scale(.82) translate(14 14)">${motifSvg(spec.motif, spec.primary, spec.secondary, spec.glow)}</g>
    <path d="M16 104Q64 124 112 104" fill="none" stroke="${spec.secondary}" stroke-width="3" opacity=".42"/>
  </svg>`;
}

export function getItemIconDataUrl(itemId: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getItemIconSvg(itemId))}`;
}
