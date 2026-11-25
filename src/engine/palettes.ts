import type { SpeciesId } from '../shared/types';

export type Rgba = readonly [number, number, number, number];

export type PotStyle = 'terracotta' | 'stoneMound' | 'slatePot' | 'ceramicTray';

export interface PotPalette {
  style: PotStyle;
  /** Four shading tones from shadow to sunlit highlight. */
  shades: readonly [Rgba, Rgba, Rgba, Rgba];
  rimHighlight: Rgba;
  soil: readonly [Rgba, Rgba, Rgba];
  seed: readonly [Rgba, Rgba];
  /** Optional accent shades for moss on stone mound or zen rock on bonsai tray. */
  detail?: readonly [Rgba, Rgba, Rgba];
}

export interface BirdPalette {
  body: Rgba;
  wing: Rgba;
  belly: Rgba;
  beak: Rgba;
  crest?: Rgba;
}

export interface SpeciesPalette {
  id: SpeciesId;
  outline: Rgba;
  /** Four bark tones: deep shadow, mid shadow, warm mid, sunlit highlight. */
  bark: readonly [Rgba, Rgba, Rgba, Rgba];
  /** Four foliage tones: cool shadow, base mid, sunlit mid, warm highlight. */
  foliage: readonly [Rgba, Rgba, Rgba, Rgba];
  /** Sprout tones: stem shadow, stem mid, bright cotyledon leaf highlight. */
  sprout: readonly [Rgba, Rgba, Rgba];
  /** Primary species accents (acorns, blossoms, snow caps, autumn crests). */
  accents: readonly Rgba[];
  /** Secondary accents (acorn caps, blossom centers, pinecones, stone flecks). */
  secondaryAccents: readonly Rgba[];
  pot: PotPalette;
  particles: {
    keystroke: readonly Rgba[];
    leaf: readonly Rgba[];
    shimmer: readonly Rgba[];
  };
  bird: BirdPalette;
  butterfly: readonly [Rgba, Rgba];
  hex: {
    outline: string;
    bark: readonly [string, string, string, string];
    foliage: readonly [string, string, string, string];
    accent: string;
    pot: string;
  };
}

function hexToRgba(hex: string, alpha = 255): Rgba {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b, alpha] as const;
}

const OUTLINE_HEX = '#17141d';
const OUTLINE_RGBA = hexToRgba(OUTLINE_HEX);

export const PALETTES: Record<SpeciesId, SpeciesPalette> = {
  oak: {
    id: 'oak',
    outline: OUTLINE_RGBA,
    bark: [
      hexToRgba('#3b2318'),
      hexToRgba('#5c3824'),
      hexToRgba('#7d4e31'),
      hexToRgba('#a36c45'),
    ],
    foliage: [
      hexToRgba('#1b4332'),
      hexToRgba('#2d6a4f'),
      hexToRgba('#52b788'),
      hexToRgba('#95d57a'),
    ],
    sprout: [
      hexToRgba('#2d6a4f'),
      hexToRgba('#52b788'),
      hexToRgba('#a9e378'),
    ],
    accents: [
      hexToRgba('#d49b35'), // golden acorn body
      hexToRgba('#f6d56f'), // acorn glint
      hexToRgba('#b8df82'), // fresh sunlit leaf tip
    ],
    secondaryAccents: [
      hexToRgba('#7c4d25'), // acorn cap
      hexToRgba('#5e371a'), // acorn cap shadow
    ],
    pot: {
      style: 'terracotta',
      shades: [
        hexToRgba('#6e2e20'),
        hexToRgba('#9c452e'),
        hexToRgba('#c25e40'),
        hexToRgba('#de7d5b'),
      ],
      rimHighlight: hexToRgba('#efa182'),
      soil: [
        hexToRgba('#36231a'),
        hexToRgba('#4f3425'),
        hexToRgba('#6b4733'),
      ],
      seed: [
        hexToRgba('#8f5d32'),
        hexToRgba('#d9a45b'),
      ],
    },
    particles: {
      keystroke: [
        hexToRgba('#ffd166'),
        hexToRgba('#fff3b0'),
        hexToRgba('#7ae582'),
      ],
      leaf: [
        hexToRgba('#52b788'),
        hexToRgba('#95d57a'),
        hexToRgba('#2d6a4f'),
      ],
      shimmer: [
        hexToRgba('#ffe680'),
        hexToRgba('#ffffff'),
      ],
    },
    bird: {
      body: hexToRgba('#3a86ff'),
      wing: hexToRgba('#1d4ed8'),
      belly: hexToRgba('#f4a261'),
      beak: hexToRgba('#ffd166'),
    },
    butterfly: [hexToRgba('#ffd166'), hexToRgba('#f4a261')],
    hex: {
      outline: OUTLINE_HEX,
      bark: ['#3b2318', '#5c3824', '#7d4e31', '#a36c45'],
      foliage: ['#1b4332', '#2d6a4f', '#52b788', '#95d57a'],
      accent: '#f6d56f',
      pot: '#c25e40',
    },
  },

  sakura: {
    id: 'sakura',
    outline: OUTLINE_RGBA,
    bark: [
      hexToRgba('#2b1926'),
      hexToRgba('#462939'),
      hexToRgba('#633c4d'),
      hexToRgba('#855767'),
    ],
    foliage: [
      hexToRgba('#9e4770'),
      hexToRgba('#d96b98'),
      hexToRgba('#f497b6'),
      hexToRgba('#ffd6e7'),
    ],
    sprout: [
      hexToRgba('#3b7a57'),
      hexToRgba('#6ab07c'),
      hexToRgba('#b8e6a3'),
    ],
    accents: [
      hexToRgba('#fff5f8'), // cream blossom highlight
      hexToRgba('#ff85b3'), // vibrant petal
      hexToRgba('#ffe0ec'), // soft pastel petal
    ],
    secondaryAccents: [
      hexToRgba('#c9184a'), // blossom center
      hexToRgba('#ffccd5'), // bud blush
    ],
    pot: {
      style: 'terracotta',
      shades: [
        hexToRgba('#703329'),
        hexToRgba('#9e4c3b'),
        hexToRgba('#c46652'),
        hexToRgba('#e08772'),
      ],
      rimHighlight: hexToRgba('#f2ac9b'),
      soil: [
        hexToRgba('#362324'),
        hexToRgba('#4f3433'),
        hexToRgba('#6b4844'),
      ],
      seed: [
        hexToRgba('#7a444d'),
        hexToRgba('#e397ab'),
      ],
    },
    particles: {
      keystroke: [
        hexToRgba('#ffd6e7'),
        hexToRgba('#fff5f8'),
        hexToRgba('#ffd166'),
      ],
      leaf: [
        hexToRgba('#f497b6'),
        hexToRgba('#ffd6e7'),
        hexToRgba('#fff5f8'),
      ],
      shimmer: [
        hexToRgba('#fff5f8'),
        hexToRgba('#ffe680'),
      ],
    },
    bird: {
      body: hexToRgba('#c98a7c'),
      wing: hexToRgba('#8a544b'),
      belly: hexToRgba('#fce8ee'),
      beak: hexToRgba('#f4c95d'),
    },
    butterfly: [hexToRgba('#ff8fab'), hexToRgba('#fff0f5')],
    hex: {
      outline: OUTLINE_HEX,
      bark: ['#2b1926', '#462939', '#633c4d', '#855767'],
      foliage: ['#9e4770', '#d96b98', '#f497b6', '#ffd6e7'],
      accent: '#fff5f8',
      pot: '#c46652',
    },
  },

  pine: {
    id: 'pine',
    outline: OUTLINE_RGBA,
    bark: [
      hexToRgba('#381d18'),
      hexToRgba('#5b2e22'),
      hexToRgba('#7e422e'),
      hexToRgba('#a15a3f'),
    ],
    foliage: [
      hexToRgba('#113038'),
      hexToRgba('#1b4d4f'),
      hexToRgba('#2d736c'),
      hexToRgba('#4ea89b'),
    ],
    sprout: [
      hexToRgba('#1f5e53'),
      hexToRgba('#3e8e7e'),
      hexToRgba('#7cd4b8'),
    ],
    accents: [
      hexToRgba('#d2ecf7'), // crisp snow shadow
      hexToRgba('#eef8fc'), // snow mid
      hexToRgba('#ffffff'), // snow sparkle
    ],
    secondaryAccents: [
      hexToRgba('#6b3c22'), // pinecone shadow
      hexToRgba('#9c5b33'), // warm pinecone
    ],
    pot: {
      style: 'stoneMound',
      shades: [
        hexToRgba('#3e4852'),
        hexToRgba('#586573'),
        hexToRgba('#778594'),
        hexToRgba('#99a8b5'),
      ],
      rimHighlight: hexToRgba('#b8c7d4'),
      soil: [
        hexToRgba('#2c3329'),
        hexToRgba('#414a3b'),
        hexToRgba('#5a634f'),
      ],
      seed: [
        hexToRgba('#5c341f'),
        hexToRgba('#9c5b33'),
      ],
      detail: [
        hexToRgba('#315e3d'),
        hexToRgba('#4e8b52'),
        hexToRgba('#7bc46b'),
      ],
    },
    particles: {
      keystroke: [
        hexToRgba('#caf0f8'),
        hexToRgba('#ffd166'),
        hexToRgba('#ffffff'),
      ],
      leaf: [
        hexToRgba('#2d736c'),
        hexToRgba('#4ea89b'),
        hexToRgba('#eef8fc'),
      ],
      shimmer: [
        hexToRgba('#ffffff'),
        hexToRgba('#ffe680'),
      ],
    },
    bird: {
      body: hexToRgba('#d62828'),
      wing: hexToRgba('#9b1b1b'),
      belly: hexToRgba('#f25c54'),
      beak: hexToRgba('#f77f00'),
      crest: hexToRgba('#d62828'),
    },
    butterfly: [hexToRgba('#90e0ef'), hexToRgba('#caf0f8')],
    hex: {
      outline: OUTLINE_HEX,
      bark: ['#381d18', '#5b2e22', '#7e422e', '#a15a3f'],
      foliage: ['#113038', '#1b4d4f', '#2d736c', '#4ea89b'],
      accent: '#eef8fc',
      pot: '#586573',
    },
  },

  maple: {
    id: 'maple',
    outline: OUTLINE_RGBA,
    bark: [
      hexToRgba('#322c2b'),
      hexToRgba('#4d4340'),
      hexToRgba('#6b5d57'),
      hexToRgba('#8c7b72'),
    ],
    foliage: [
      hexToRgba('#9b2226'),
      hexToRgba('#d94826'),
      hexToRgba('#f48c06'),
      hexToRgba('#ffca3a'),
    ],
    sprout: [
      hexToRgba('#587039'),
      hexToRgba('#89a84f'),
      hexToRgba('#d4c86a'),
    ],
    accents: [
      hexToRgba('#ff4d2e'), // fiery scarlet leaf
      hexToRgba('#ffe066'), // sunlit gold tip
      hexToRgba('#ff9f1c'), // tangerine ember
    ],
    secondaryAccents: [
      hexToRgba('#7a161b'), // deep crimson vein
      hexToRgba('#ffb703'), // warm amber
    ],
    pot: {
      style: 'slatePot',
      shades: [
        hexToRgba('#2f3b47'),
        hexToRgba('#435363'),
        hexToRgba('#5b7085'),
        hexToRgba('#7c93ab'),
      ],
      rimHighlight: hexToRgba('#9fb6cf'),
      soil: [
        hexToRgba('#33251e'),
        hexToRgba('#4a372c'),
        hexToRgba('#664b3b'),
      ],
      seed: [
        hexToRgba('#8a4b29'),
        hexToRgba('#d9843b'),
      ],
    },
    particles: {
      keystroke: [
        hexToRgba('#ffca3a'),
        hexToRgba('#ff9f1c'),
        hexToRgba('#fff3b0'),
      ],
      leaf: [
        hexToRgba('#d94826'),
        hexToRgba('#f48c06'),
        hexToRgba('#ffca3a'),
      ],
      shimmer: [
        hexToRgba('#ffe680'),
        hexToRgba('#fff3b0'),
      ],
    },
    bird: {
      body: hexToRgba('#8c5a3c'),
      wing: hexToRgba('#5c3824'),
      belly: hexToRgba('#f2d5b8'),
      beak: hexToRgba('#e9c46a'),
    },
    butterfly: [hexToRgba('#ff9f1c'), hexToRgba('#ffe66d')],
    hex: {
      outline: OUTLINE_HEX,
      bark: ['#322c2b', '#4d4340', '#6b5d57', '#8c7b72'],
      foliage: ['#9b2226', '#d94826', '#f48c06', '#ffca3a'],
      accent: '#ffca3a',
      pot: '#5b7085',
    },
  },

  bonsai: {
    id: 'bonsai',
    outline: OUTLINE_RGBA,
    bark: [
      hexToRgba('#2b211b'),
      hexToRgba('#47362b'),
      hexToRgba('#69503f'),
      hexToRgba('#8f7058'),
    ],
    foliage: [
      hexToRgba('#15332b'),
      hexToRgba('#235243'),
      hexToRgba('#387d63'),
      hexToRgba('#64ab85'),
    ],
    sprout: [
      hexToRgba('#235243'),
      hexToRgba('#458f6d'),
      hexToRgba('#8cd4a5'),
    ],
    accents: [
      hexToRgba('#ffb3c6'), // tiny pink bonsai bloom
      hexToRgba('#fff0f5'), // crisp white bloom
      hexToRgba('#88d19e'), // jade leaf highlight
    ],
    secondaryAccents: [
      hexToRgba('#6c757d'), // zen stone mid
      hexToRgba('#adb5bd'), // zen stone highlight
    ],
    pot: {
      style: 'ceramicTray',
      shades: [
        hexToRgba('#183059'),
        hexToRgba('#224885'),
        hexToRgba('#3166b5'),
        hexToRgba('#5d94de'),
      ],
      rimHighlight: hexToRgba('#8dbbff'),
      soil: [
        hexToRgba('#2d241f'),
        hexToRgba('#45372e'),
        hexToRgba('#614e41'),
      ],
      seed: [
        hexToRgba('#543f2d'),
        hexToRgba('#967355'),
      ],
      detail: [
        hexToRgba('#4d555e'),
        hexToRgba('#78828c'),
        hexToRgba('#a9b3bd'),
      ],
    },
    particles: {
      keystroke: [
        hexToRgba('#ffe680'),
        hexToRgba('#ffb3c6'),
        hexToRgba('#88d19e'),
      ],
      leaf: [
        hexToRgba('#387d63'),
        hexToRgba('#64ab85'),
        hexToRgba('#ffb3c6'),
      ],
      shimmer: [
        hexToRgba('#fff5f8'),
        hexToRgba('#ffe680'),
      ],
    },
    bird: {
      body: hexToRgba('#6a994e'),
      wing: hexToRgba('#386641'),
      belly: hexToRgba('#f2e8cf'),
      beak: hexToRgba('#e9c46a'),
    },
    butterfly: [hexToRgba('#ffd6e0'), hexToRgba('#ffffff')],
    hex: {
      outline: OUTLINE_HEX,
      bark: ['#2b211b', '#47362b', '#69503f', '#8f7058'],
      foliage: ['#15332b', '#235243', '#387d63', '#64ab85'],
      accent: '#ffb3c6',
      pot: '#3166b5',
    },
  },
};
