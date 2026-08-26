/* Direccion visual: paletas indexadas de los dos bandos, tablero, escena e interfaz.
   Las claves de `sprite` son SEMANTICAS y las comparten los seis sprites:
   # contorno · A/B/C armadura o cuerpo (claro/medio/oscuro) · S/T piel · E/P ojo
   M/N metal · G/H oro o bronce · R/D tela del bando · W brillo · X magia · K madera o cuero. */
const THEME = {
  sprite: {
    /* Orden de la Luz: acero pulido, azul heraldico y oro. */
    w: {
      '#': '#0e1420', 'A': '#eaf1f8', 'B': '#b9c8da', 'C': '#7d8ea6',
      'S': '#f0c091', 'T': '#c2865a', 'E': '#ffffff', 'P': '#161b26',
      'M': '#e6eef8', 'N': '#8798ad', 'G': '#ffd257', 'H': '#b57d1c',
      'R': '#4d8fd6', 'D': '#28568f', 'W': '#ffffff', 'X': '#7ef0ff', 'K': '#8d5c32'
    },
    /* Horda de la Sombra: hierro ennegrecido, carmesi y bronce. */
    b: {
      '#': '#170c0c', 'A': '#6e6673', 'B': '#4e4854', 'C': '#332e39',
      'S': '#c08a63', 'T': '#8a5a3c', 'E': '#f2e2dd', 'P': '#1a1016',
      'M': '#9d94a6', 'N': '#5c5464', 'G': '#c98b3a', 'H': '#7d5320',
      'R': '#b23548', 'D': '#6d1c2c', 'W': '#e8dad6', 'X': '#ff6fd8', 'K': '#5a3a24'
    }
  },
  /* Piedra clara desgastada contra pizarra musgosa. */
  board: {
    light: '#d9cdb4', lightEdge: '#efe6d2', dark: '#4a5750', darkEdge: '#3a463f',
    border: '#2b2119', borderHi: '#6b563a', grout: '#241d16',
    sel: '#ffd447', selGlow: 'rgba(255,212,71,0.55)', moveDot: 'rgba(255,235,150,0.78)',
    capRing: '#e0563f', lastFrom: 'rgba(120,170,255,0.26)', lastTo: 'rgba(120,170,255,0.44)',
    checkGlow: 'rgba(226,60,50,0.55)', hover: 'rgba(255,246,214,0.55)'
  },
  scene: {
    skyTop: '#141a2b', skyBot: '#3a3350', fogFar: 'rgba(120,130,170,0.35)',
    floor: '#2a2420', vignette: 'rgba(8,6,10,0.65)', shadow: 'rgba(10,8,14,0.45)'
  },
  ui: {
    bg: '#141019', panel: '#2a2119', panelEdge: '#6b563a', ink: '#f2e4c8',
    inkDim: '#a89377', gold: '#e8b64c', accentW: '#a8ccf5', accentB: '#e08a7a',
    danger: '#d6493c', ok: '#7fbf5f'
  },
  fx: {
    spark: '#fff3c4', spark2: '#ffb347', magicW: '#7ef0ff', magicB: '#ff6fd8',
    stone: '#9a8f7a', dust: 'rgba(200,185,150,0.5)', flash: 'rgba(255,248,220,0.85)'
  }
};
