// ============================================================
// Agent RTS - Unified Color Palette
// ============================================================
// Single source of truth for all colors used across rendering,
// UI, and CSS. Every rendering file imports from here instead
// of hardcoding color values.
// ============================================================

export const PALETTE = {
  bg:      { canvas: '#12131a', sidebar: '#181c28', surface: '#1e2230' },
  border:  { base: '#2a3040', highlight: '#3a4558' },
  text:    { primary: '#d8dce4', muted: '#6b7280', disabled: '#4b5060' },
  accent:  { green: '#4ade80', cyan: '#67c8e8', gold: '#f0c040', red: '#ef5350', orange: '#e8924a' },
  player:  ['#5b9bd5', '#d45a5a', '#5cb87a', '#d4944c'],
  terrain: {
    plains:   { base: '#4a7a56', dark: '#3b6345', light: '#5f9468' },
    forest:   { base: '#2b5028', dark: '#1e3a1c', light: '#3d6835' },
    mountain: { base: '#7a6b52', dark: '#5c5040', light: '#9a8a6e' },
    water:    { base: '#1a4a6e', dark: '#12354d', light: '#2a6a90' },
    swamp:    { base: '#485a3e', dark: '#354530', light: '#5a6e4e' },
  },
  fog:     { unexplored: '#0a0b10', explored: 'rgba(10,11,16,0.55)' },
  ui:      { healthHigh: '#4ade80', healthMid: '#f0c040', healthLow: '#ef5350',
             minerals: '#67c8e8', energy: '#f0c040', selection: '#4ade80' },
  grid:    { lines: 'rgba(255,255,255,0.06)', labels: 'rgba(255,255,255,0.25)' },
  building: { scaffold: 'rgba(110,80,50,0.35)', foundation: 'rgba(110,80,50,0.6)',
              constructionEdge: 'rgba(240,192,64,0.6)' },
  equipment: {
    leather: { r: 100, g: 70, b: 40 },
    steel:   { r: 180, g: 180, b: 195 },
    gold:    { r: 220, g: 190, b: 60 },
    wood:    { r: 120, g: 80, b: 45 },
  },
};
