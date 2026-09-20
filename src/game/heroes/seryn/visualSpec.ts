export const SERYN_VISUAL_SPEC = {
  heroId: 'H002',
  silhouette: 'Lean ranged scout with a tall asymmetrical prism bow; lighter and narrower than Alden.',
  palette: {
    primary: 'deep midnight blue',
    secondary: 'weathered silver',
    accent: 'cyan-white prism light',
    cloth: 'desaturated teal',
  },
  armor: 'Light segmented cuirass, bracers and shin guards; no heavy pauldrons and no cape large enough to obscure the bow silhouette.',
  weapon: 'Oversized recurved prism longbow with physical limbs and an energy string. Physical quiver remains visible on the back/hip.',
  face: 'Human, alert expression, practical field gear; avoid royal-knight motifs used by Alden.',
  vfxLanguage: 'Straight cartographic lines, lens refraction, triangular prism flares and clean horizon arcs. Avoid fire, lightning and generic magic circles.',
  animationNotes: [
    'Idle keeps the bow low and the body side-on, weight on the rear foot.',
    'Basic attack must visibly draw and release the energy string.',
    'Q exaggerates the full draw and leaves a narrow refracted trail.',
    'W is a short grounded evasive step, not a teleport.',
    'E throws or fires a small prism anchor into the terrain.',
    'R plants Seryn into a deliberate firing stance for three line shots.',
  ],
} as const;

export const SERYN_REQUIRED_RUNTIME_IMAGES = [
  'H002.webp',
  'H002F.webp',
  'H002I.webp',
  'H002P.webp',
  'H002Q.webp',
  'H002W.webp',
  'H002E.webp',
  'H002R.webp',
] as const;
