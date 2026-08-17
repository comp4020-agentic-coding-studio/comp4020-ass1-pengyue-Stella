import {
  formatThickness,
  getPreset,
  physicalFoldLimit,
  thicknessAfterFolds,
  type PaperPreset,
} from "./fold";

// --- World / camera -------------------------------------------------------
// One shared coordinate system, in world millimetres, ground at y = 0.
// The camera is a single <g transform> — translate is constant, scale (k)
// shrinks as the taller of {paper, reference} grows, so the whole world
// visibly zooms out while the ground stays pinned on screen.
const CAMERA_X = 240;
const CAMERA_Y = 280;
const TARGET_SPAN = 230;
const MIN_VISUAL_FRACTION = 0.02;

// How much of the ground-to-top-of-frame headroom (CAMERA_Y — the local
// y-distance from the ground line to the top of the viewBox) the folded
// paper column may occupy before the *reference* scene starts shrinking
// instead. Replaces the old fixed TARGET_SPAN/WORLD_MARGIN ceiling (~66% of
// this same headroom, i.e. 184 of 280 units) — that ceiling capped the paper
// alone, so once a scene's real reference was exceeded by enough, the
// paper's screen height became a flat constant for however many folds
// followed. See render()'s comment for the replacement mechanism.
const MAX_PAPER_HEADROOM_FRACTION = 0.84;
const MAX_PAPER_LOCAL_HEIGHT = MAX_PAPER_HEADROOM_FRACTION * CAMERA_Y;

// Floor on how far the reference scene may shrink relative to its normal
// size once the paper has pinned at MAX_PAPER_LOCAL_HEIGHT — mirrors
// MIN_VISUAL_FRACTION's role for the paper itself, so a reference that stays
// "closest" across a long run of folds (e.g. Earth-Moon, before the Milky
// Way ever becomes nearer) never shrinks to nothing.
const MIN_REFERENCE_SCALE = 0.08;

// Stage C: once a single closest object has pinned *both* the paper at
// MAX_PAPER_LOCAL_HEIGHT and the reference at MIN_REFERENCE_SCALE, every
// later fold with that same object would otherwise render pixel-identical
// forever despite thicknessMm still doubling. cameraZoomLevel is a
// multiplier applied to both of those limits while genuinely "stuck" (see
// updateCameraZoomLevel), so k and referenceScale keep moving every fold
// instead of freezing — a gentle, ongoing pull-back rather than a sudden
// jump. It resets to 1 the moment the closest object changes, since a fresh
// object deserves its own full-quality view, not an inherited pull-back.
const CAMERA_ZOOM_STEP = 0.97;
const MIN_CAMERA_ZOOM = 0.3;

// --- Scene-calibrated display scale --------------------------------------
// The paper's on-screen height and the scene photo's on-screen height are
// two independent rendering systems (SVG camera vs. a raster <img>), so a
// generic "fit the taller thing" auto-zoom has no real relationship to how
// tall a given comparison object actually looks in its photo. Instead, each
// SceneObject below carries heightPct: the fraction of the scene-stage box's
// own height that this object's real-world height occupies in its photo
// (estimated by eye from the source images — e.g. the person in scene 2 is
// about 12% of that photo's height). That turns "this many real mm" into
// "this many on-screen units", per object, so the paper renders at the same
// visual scale as whichever object it's currently being compared to.
//
// SCENE_STAGE_WIDTH_FRACTION/SCENE_IMAGE_ASPECT must match .scene-stage's
// width/aspect-ratio in styles.css — they exist here only to derive how
// tall the stage box is relative to the world's own camera view, in the
// same viewBox units the camera uses.
const SCENE_STAGE_WIDTH_FRACTION = 0.62;
const SCENE_IMAGE_ASPECT = 2048 / 1152;
const WORLD_VIEWBOX_ASPECT = 480 / 340;
const WORLD_VIEWBOX_HEIGHT = 340;
const STAGE_HEIGHT_VB =
  ((SCENE_STAGE_WIDTH_FRACTION / SCENE_IMAGE_ASPECT) * WORLD_VIEWBOX_ASPECT) * WORLD_VIEWBOX_HEIGHT;

// The scene art now lives in a right-hand gutter starting around 38% into
// the world (see .scene-stage in styles.css), leaving more room on the left
// than the old full-width backdrop did — this fraction resolves to a fixed
// screen position independent of zoom (screen x = CAMERA_X +
// PAPER_X_FRACTION * TARGET_SPAN), so the paper stays inside the reserved
// left column, and inside the visible viewBox (0–480), at any fold count,
// in every scene.
const PAPER_X_FRACTION = -0.75;

const FLAT_BAND_HEIGHT_MM = 9;
const FLAT_BASE_WIDTH_MM = 55;
// Decorative only — a rough sense that a "giant sheet" starts wider than an
// A4 sheet, not a claim about exact real-world proportions.
const FLAT_WIDTH_SCALE: Record<string, number> = {
  a4: 1,
  newspaper: 1.3,
  large: 1.15,
  giant: 1.5,
};

// Expressed as fractions of worldHeightMm (like MIN_VISUAL_FRACTION for
// height), not fixed mm — a fixed-mm width shrinks to sub-pixel on screen
// as the camera zooms out at high fold counts, which is what made the
// paper graphic disappear. A fraction of worldHeightMm scales with 1/k the
// same way height's floor does, so on-screen width never goes to zero.
const STACK_BASE_WIDTH_FRACTION = 0.052;
const STACK_MIN_WIDTH_FRACTION = 0.017;
const STACK_WIDTH_SHRINK_FACTOR = 0.92;

const FOLD_FLIP_MS = 420;
const STACK_REVEAL_MS = 360;
const FLEX_MS = 300;

// The Milky Way's real diameter (~100,000 light-years, in mm) and the factor
// within which the paper's thickness must fall before that comparison is
// allowed to activate — see the milky-way SceneObject's minActivationMm for
// why this needs a floor at all.
const MILKY_WAY_HEIGHT_MM = 9.4607e23;
const MILKY_WAY_ACTIVATION_FACTOR = 2;

// A single named, representative Oort Cloud outer-scale distance (its real
// extent is only ever cited as a wide "thousands to tens of thousands of AU"
// range) so the annotation and caption below have one concrete number to
// compare against, the same way every other comparison scene does — 50,000 AU
// is the commonly-cited round figure for the outer edge. Derived from
// AU_IN_MM rather than written as a bare mm literal, matching how
// MILKY_WAY_HEIGHT_MM above is derived from a named light-year figure.
const AU_IN_MM = 1.495978707e14;
const OORT_CLOUD_AU = 50000;
// The Alpha Centauri system's real distance, 4.37 light-years
// (1 ly = 9.4607304726e18 mm, matching MILKY_WAY_HEIGHT_MM's own 100,000-ly
// figure above). Both this and the Oort Cloud slot into closestReference()'s
// ordinary unconstrained log-nearest-neighbour match with no activation floor
// of their own — at these real magnitudes the crossover from the Sun-Neptune
// distance lands around fold 61, Oort-to-Alpha-Centauri around fold 67, and
// (unchanged) the Milky Way's own gate still binds first at fold 82 — so the
// fold-60s stretch that used to hold a single frozen Sun-Neptune scene now
// steps through four progressively larger comparisons instead of one long
// stall.
const OORT_CLOUD_HEIGHT_MM = AU_IN_MM * OORT_CLOUD_AU;
const ALPHA_CENTAURI_HEIGHT_MM = 4.1337e19;

// Hard end to the experience — see enterEnding()/exitEnding() below. Folding
// indefinitely eventually has nothing left to say once even Stage C's
// zoom-out has done what it can; a deliberate stopping point at a clearly
// deep-space fold count reads as an ending rather than the page just running
// out of ideas.
const MAX_FOLDS = 90;

type SceneObject = {
  id: string;
  label: string;
  heightMm: number;
  fact: string;
  // Position of this object within its own scene image, as a percentage of
  // the image's box (0–100, top-left origin) — used only to place the
  // spotlight glow and aim the leader-line arrow, never to move or resize
  // the artwork.
  anchorXPct: number;
  anchorYPct: number;
  // This object's own on-screen height, as a percentage of the scene-stage
  // box's height (estimated from the source image) — the calibration used
  // to give the paper a matching real-world display scale in this scene.
  heightPct: number;
  // Full override for the annotation bubble's text, for objects whose real
  // size reads far more naturally in km/light-years than in the mm-based
  // formatThickness() ladder (which stays untouched for the paper's own
  // thickness readout). Falls back to the generic label/formatThickness
  // template when omitted.
  bubbleText?: string;
  // Optional glowing line-segment endpoints (same 0–100 scene-stage-box
  // percentage space as anchorXPct), for objects that represent a
  // horizontal span across the scene rather than a single point — e.g. a
  // Sun-to-planet distance drawn across the Solar System strip photo. When
  // present, renderComparisonScene draws a glowing bar between these two
  // x-percentages (at anchorYPct) instead of the default radial point glow.
  // anchorXPct should be their midpoint, so the existing leader-line arrow
  // (which always targets anchorXPct/anchorYPct — see updateLeaderLine)
  // points at the line itself with no extra code.
  lineFromXPct?: number;
  lineToXPct?: number;
  // Gates this object out of closestReference()'s candidate set until the
  // paper's thickness reaches this many mm. Only needed for an object sparse
  // enough that the plain log-nearest-neighbour match would otherwise hand
  // the annotation to it long before the paper is genuinely that scale (see
  // the Milky Way entry below) — every other object relies on the ordinary
  // unconstrained match.
  minActivationMm?: number;
  // Per-fold retention factor (0 < value < 1) for how gradually this
  // object's reference-scene scale eases toward Stage B's mathematically
  // exact ratio once the paper has pinned at its ceiling — see render()'s
  // updateEasedReferenceScale. Left unset (every object except Alpha
  // Centauri), Stage B snaps straight to that exact ratio every single fold,
  // which is correct but, for an object whose ceiling-crossing ratio roughly
  // halves each fold, collapses the reference photo to MIN_REFERENCE_SCALE
  // within about four folds — visually freezing every fold after that for as
  // long as the object stays closest. Setting this closer to 1 spreads the
  // same shrink out over more folds instead, at the cost of the reference
  // staying a little larger than the exact ratio would call for while it's
  // easing down — the same kind of trade-off Stage C's cameraZoomLevel
  // already makes deliberately, in service of the same goal (something
  // visibly changes every fold instead of freezing).
  referenceDecay?: number;
};

// The one source of truth for which visual mode a scene belongs to. Scenes
// 1-6 (grass through the ISS) stay "everyday" scale and keep the warm
// hand-drawn look — the ISS is still a single concrete human-made object,
// same narrative register as the buildings and Everest. Scene 7 onward (the
// half-Earth + Kármán-line scene and beyond) is "space" scale and switches
// the whole page to the dark cosmic palette — see [data-theme="space"] in
// styles.css, which redefines the same shared --ink/--paper/--accent tokens
// everything else already reads, rather than a parallel dark-mode system.
type ThemeMode = "everyday" | "space";

type Scene = { id: string; src: string; theme: ThemeMode; objects: SceneObject[] };

// Four fixed illustrations, each a real hand-drawn or composited scene, not
// a formula-positioned doodle. Every comparison object shown in the story
// is one that scene actually draws — nothing is synthesised on top.
const SCENES: Scene[] = [
  {
    id: "scene1",
    src: "./images/1.png",
    theme: "everyday",
    objects: [
      {
        id: "grass",
        label: "a blade of grass",
        heightMm: 100,
        fact: "still shorter than most shoes.",
        anchorXPct: 17,
        anchorYPct: 86,
        heightPct: 11,
      },
      {
        id: "flower",
        label: "a small flower",
        heightMm: 250,
        fact: "just tall enough to nod in the wind.",
        anchorXPct: 21,
        anchorYPct: 83,
        heightPct: 17,
      },
      {
        id: "cat",
        label: "a sitting cat",
        heightMm: 350,
        fact: "about as tall as a cat sitting up.",
        anchorXPct: 38,
        anchorYPct: 80,
        heightPct: 20,
      },
      {
        id: "table",
        label: "a round table",
        heightMm: 750,
        fact: "coffee-table height.",
        anchorXPct: 82,
        anchorYPct: 58,
        heightPct: 44,
      },
      {
        id: "chair",
        label: "a chair",
        heightMm: 900,
        fact: "you're now around furniture scale.",
        anchorXPct: 58,
        anchorYPct: 52,
        heightPct: 50,
      },
    ],
  },
  {
    id: "scene2",
    src: "./images/2.png",
    theme: "everyday",
    objects: [
      {
        id: "person",
        label: "a person",
        heightMm: 1700,
        fact: "about an average adult's height.",
        anchorXPct: 24,
        anchorYPct: 87,
        heightPct: 12,
      },
      {
        id: "tree",
        label: "a tree",
        heightMm: 8000,
        fact: "eight metres — taller than most houses.",
        anchorXPct: 68,
        anchorYPct: 20,
        heightPct: 82,
      },
    ],
  },
  {
    id: "scene3",
    src: "./images/3.png",
    theme: "everyday",
    objects: [
      {
        id: "wukang",
        label: "the Wukang Building",
        heightMm: 30000,
        fact: "a classic Shanghai landmark.",
        anchorXPct: 15,
        anchorYPct: 87,
        heightPct: 16,
      },
      {
        id: "opera",
        label: "the Sydney Opera House",
        heightMm: 65000,
        fact: "its sail-like roof made it world famous.",
        anchorXPct: 78,
        anchorYPct: 15,
        heightPct: 95,
      },
    ],
  },
  {
    id: "scene4",
    src: "./images/4.png",
    theme: "everyday",
    objects: [
      {
        id: "burj",
        label: "the Burj Khalifa",
        heightMm: 828000,
        fact: "the tallest building in the world.",
        anchorXPct: 50,
        anchorYPct: 5,
        heightPct: 96,
      },
    ],
  },
  {
    id: "scene5",
    src: "./images/9.png",
    theme: "everyday",
    objects: [
      {
        id: "everest",
        label: "Mount Everest",
        heightMm: 8.85e6,
        fact: "Earth's highest peak above sea level.",
        anchorXPct: 70,
        anchorYPct: 34,
        heightPct: 66,
      },
    ],
  },
  {
    id: "scene6",
    src: "./images/10.png",
    theme: "everyday",
    objects: [
      {
        id: "iss",
        label: "the ISS",
        heightMm: 4.0e8,
        fact: "it orbits in low Earth orbit, circling the planet roughly every 90 minutes.",
        bubbleText:
          "The International Space Station — orbits about 400 km above Earth, in low Earth orbit.",
        anchorXPct: 50,
        anchorYPct: 42,
        heightPct: 60,
      },
    ],
  },
  {
    id: "scene7",
    src: "./images/11.jpg",
    theme: "space",
    objects: [
      {
        id: "karman",
        label: "the edge of space",
        heightMm: 6.471e9,
        fact: "measured from Earth's centre — its 6,371 km radius plus the 100 km Kármán line.",
        bubbleText:
          "From Earth's centre to the Kármán line — about 6,471 km (6,371 km radius + the 100 km edge of space).",
        anchorXPct: 50,
        anchorYPct: 11,
        heightPct: 89,
      },
    ],
  },
  {
    id: "scene8",
    src: "./images/5.avif",
    theme: "space",
    objects: [
      {
        id: "earth",
        label: "Earth",
        heightMm: 1.2742e10,
        fact: "now we're comparing against whole planets.",
        bubbleText: "Earth — about 12,742 km across.",
        anchorXPct: 50,
        anchorYPct: 53,
        heightPct: 60,
      },
    ],
  },
  {
    id: "scene9",
    src: "./images/7.jpg",
    theme: "space",
    // Jupiter is visible in the same photo but isn't a scene object here:
    // with it as a second candidate, closestReference() briefly hands the
    // annotation to Jupiter for a fold between the Saturn and Earth-Moon
    // anchors. The full multi-planet image is unaffected either way — this
    // only changes which object in it is treated as the measured reference.
    objects: [
      {
        id: "earth-planetary",
        label: "Earth",
        heightMm: 1.2742e10,
        fact: "now we're comparing against whole planets.",
        bubbleText: "Earth — about 12,742 km across.",
        anchorXPct: 18,
        anchorYPct: 50,
        heightPct: 8,
      },
      {
        id: "saturn",
        label: "Saturn",
        heightMm: 1.1646e11,
        fact: "famous for its rings.",
        bubbleText:
          "Saturn — about 116,460 km across. Famous for its rings. The folded paper is now roughly Saturn-scale.",
        anchorXPct: 59,
        anchorYPct: 50,
        heightPct: 62,
      },
      // Six Sun-to-planet distances, all drawn across this same unmodified
      // strip photo as a glowing line from the Sun's limb (~1.5% across the
      // image) to that planet's own centre — never a crop or an isolated
      // planet. Each reuses saturn/earth-planetary's heightPct (85, matching
      // the Earth–Moon distance object below) since, like that object, these
      // are labelled spans rather than a rendered body's own pixel height.
      // Their heightMm values (real Sun-to-planet distances in km × 1e6)
      // slot in ascending order between Saturn's own diameter and the
      // Earth–Moon distance's neighbours, so closestReference()'s existing
      // log-distance matching sequences them automatically — no fold-number
      // thresholds hard-coded anywhere.
      {
        id: "sun-mercury",
        label: "the Sun–Mercury distance",
        heightMm: 5.79e13,
        fact: "Mercury is the innermost planet, closest to the Sun.",
        bubbleText:
          "Sun to Mercury — about 57.9 million km. Mercury is the innermost planet, closest to the Sun.",
        anchorXPct: 5.25,
        anchorYPct: 50,
        heightPct: 85,
        lineFromXPct: 1.5,
        lineToXPct: 9,
      },
      {
        id: "sun-venus",
        label: "the Sun–Venus distance",
        heightMm: 1.082e14,
        fact: "Venus is Earth's hottest neighbour, wrapped in thick cloud.",
        bubbleText:
          "Sun to Venus — about 108.2 million km. Venus is Earth's hottest neighbour, wrapped in thick cloud.",
        anchorXPct: 7.575,
        anchorYPct: 50,
        heightPct: 85,
        lineFromXPct: 1.5,
        lineToXPct: 13.65,
      },
      {
        id: "sun-mars",
        label: "the Sun–Mars distance",
        heightMm: 2.279e14,
        fact: "Mars is the red planet, a frequent target for exploration.",
        bubbleText:
          "Sun to Mars — about 227.9 million km. Mars is the red planet, a frequent target for exploration.",
        anchorXPct: 12,
        anchorYPct: 50,
        heightPct: 85,
        lineFromXPct: 1.5,
        lineToXPct: 22.5,
      },
      {
        id: "sun-jupiter",
        label: "the Sun–Jupiter distance",
        heightMm: 7.785e14,
        fact: "Jupiter is the solar system's largest planet.",
        bubbleText:
          "Sun to Jupiter — about 778.5 million km. Jupiter is the solar system's largest planet.",
        anchorXPct: 19.375,
        anchorYPct: 50,
        heightPct: 85,
        lineFromXPct: 1.5,
        lineToXPct: 37.25,
      },
      {
        id: "sun-saturn",
        label: "the Sun–Saturn distance",
        heightMm: 1.43e15,
        fact: "Saturn, the ringed giant, sits over a billion kilometres from the Sun.",
        bubbleText:
          "Sun to Saturn — about 1.43 billion km. Saturn, the ringed giant, sits over a billion kilometres from the Sun.",
        anchorXPct: 30.25,
        anchorYPct: 50,
        heightPct: 85,
        lineFromXPct: 1.5,
        lineToXPct: 59,
      },
      {
        id: "sun-neptune",
        label: "the Sun–Neptune distance",
        heightMm: 4.5e15,
        fact: "Neptune is the outermost major planet.",
        bubbleText:
          "Sun to Neptune — about 4.50 billion km. Neptune is the outermost major planet.",
        anchorXPct: 43.25,
        anchorYPct: 50,
        heightPct: 85,
        lineFromXPct: 1.5,
        lineToXPct: 85,
      },
    ],
  },
  {
    id: "scene10",
    src: "./images/6.webp",
    theme: "space",
    objects: [
      {
        id: "earth-moon",
        label: "the Earth–Moon distance",
        heightMm: 3.844e11,
        fact: "that's the Moon's average distance from Earth.",
        bubbleText:
          "Earth to Moon — about 384,400 km. That's the Moon's average distance from Earth.",
        anchorXPct: 55,
        anchorYPct: 50,
        heightPct: 85,
      },
    ],
  },
  {
    id: "scene12",
    src: "./images/12.jpg",
    theme: "space",
    objects: [
      {
        id: "oort-cloud",
        label: "the Oort Cloud",
        heightMm: OORT_CLOUD_HEIGHT_MM,
        fact: "a vast shell of icy bodies surrounding the Solar System.",
        bubbleText:
          "Oort Cloud — about 50,000 AU from the Sun, roughly 7.5 trillion km. A vast shell of icy bodies surrounding the Solar System.",
        // The source photo (images/12.jpg) is a 720x720 square, narrower
        // than .scene-stage's 2048/1152 box, so object-fit: contain fits it
        // to the box's height and letterboxes left/right — the icy shell
        // fills the full vertical extent but only the middle ~56% of the
        // box's width, centred. anchorXPct/Y below are given in that
        // letterboxed stage-box space (not raw image pixels), aimed at the
        // shell's own upper-right rim rather than the Sun-point or the
        // inset Solar System diagram at the photo's centre/lower-right.
        anchorXPct: 69,
        anchorYPct: 17,
        heightPct: 90,
      },
    ],
  },
  {
    id: "scene13",
    src: "./images/13.png",
    theme: "space",
    objects: [
      {
        id: "alpha-centauri",
        label: "the Alpha Centauri system",
        heightMm: ALPHA_CENTAURI_HEIGHT_MM,
        fact: "our nearest neighbouring star system.",
        bubbleText:
          "Alpha Centauri system — about 4.37 light-years away. Our nearest neighbouring star system.",
        // The source photo (images/13.png, 594x253) is a wide strip rather
        // than a single point, so — like the Sun-to-planet distances above —
        // this is a labelled span, not a rendered body's own pixel height:
        // a glowing bar (rendered via lineFromXPct/lineToXPct) frames the
        // three depicted stars left-to-right rather than marking just one of
        // them, so the arrow lands on the highlighted group itself instead
        // of on any single star or on blank starfield. anchorXPct is that
        // span's own midpoint, per the lineFromXPct/lineToXPct contract.
        // heightPct: 85 reuses the convention already used for every other
        // span object below (the Sun-to-planet distances, the Earth–Moon
        // distance) rather than any one star's own rendered diameter.
        anchorXPct: 46,
        anchorYPct: 57,
        heightPct: 85,
        lineFromXPct: 19,
        lineToXPct: 72,
        // Alpha Centauri stays "closest" for a long stretch (fold ~68-81)
        // during which Stage B's exact ratio would otherwise halve the
        // reference scale every fold and hit MIN_REFERENCE_SCALE within
        // about four folds — freezing most of that range. 0.92 spreads the
        // same shrink out across roughly the whole stretch instead, so it
        // keeps visibly evolving right up to the Milky Way handover.
        referenceDecay: 0.92,
      },
    ],
  },
  {
    id: "scene11",
    src: "./images/8.jpg",
    theme: "space",
    objects: [
      {
        id: "milky-way",
        label: "the Milky Way",
        heightMm: MILKY_WAY_HEIGHT_MM,
        fact: "now we're thinking on galactic scales.",
        bubbleText:
          "Milky Way — about 100,000 light-years across. Now we're thinking on galactic scales.",
        anchorXPct: 50,
        anchorYPct: 50,
        heightPct: 90,
        // Without a floor, closestReference()'s plain log-nearest-neighbour
        // match hands the annotation to the Milky Way (~4 orders of
        // magnitude past its nearest neighbour, the Alpha Centauri system)
        // around fold 76 — the log-geometric-mean crossover between the two
        // — long before the paper is actually within galactic range. Gating
        // activation to within a factor of MILKY_WAY_ACTIVATION_FACTOR of the
        // real diameter instead ties the handover to the paper's actual
        // scale: log2(MILKY_WAY_HEIGHT_MM / MILKY_WAY_ACTIVATION_FACTOR /
        // 0.1mm) ≈ 82, so an A4 sheet reaches it at fold 82, not 76.
        minActivationMm: MILKY_WAY_HEIGHT_MM / MILKY_WAY_ACTIVATION_FACTOR,
      },
    ],
  },
];

// Derived directly from each scene's own `theme` field above — not a second,
// separately-maintained map — so a scene's visual mode always matches its
// data-model entry.
const SCENE_THEME: Record<string, ThemeMode> = Object.fromEntries(
  SCENES.map((scene) => [scene.id, scene.theme]),
);

type SceneObjectWithScene = SceneObject & { sceneId: string };

// Ascending real-world heights (mm) across every scene — the closest one to
// the current stack height becomes the single active comparison object.
const ALL_OBJECTS: SceneObjectWithScene[] = SCENES.flatMap((scene) =>
  scene.objects.map((obj) => ({ ...obj, sceneId: scene.id })),
);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const paperPicker = document.querySelector<HTMLDialogElement>("#paper-picker");
const presetButtons = document.querySelectorAll<HTMLButtonElement>(".preset-card");

const sceneEl = document.querySelector<HTMLElement>("#scene");
const endingCopyEl = document.querySelector<HTMLElement>("#ending-copy");

const sceneCaptionEl = document.querySelector<HTMLElement>("#scene-caption");
const changeSheetButton = document.querySelector<HTMLButtonElement>("#change-sheet");

const worldEl = document.querySelector<HTMLElement>(".world");
const worldSvgEl = document.querySelector<SVGSVGElement>("#world-svg");
const leaderLineEl = document.querySelector<SVGPathElement>("#leader-line");
const sceneStageEl = document.querySelector<HTMLElement>("#scene-stage");

const cameraEl = document.querySelector<SVGGElement>("#camera");
const groundLineEl = document.querySelector<SVGLineElement>("#ground-line");

const paperFlatZoomEl = document.querySelector<SVGGElement>("#paper-flat-zoom");
const paperFlatEl = document.querySelector<SVGGElement>("#paper-flat");
const flatLeftEl = document.querySelector<SVGRectElement>("#flat-left");
const flatRightEl = document.querySelector<SVGRectElement>("#flat-right");
const flatShadow = document.querySelector<SVGRectElement>("#flat-shadow");
const foldCrease = document.querySelector<SVGLineElement>("#fold-crease");

const paperStackEl = document.querySelector<SVGGElement>("#paper-stack");
const stackOutline = document.querySelector<SVGRectElement>("#stack-outline");
const stackShadow = document.querySelector<SVGRectElement>("#stack-shadow");

const guideLine = document.querySelector<SVGLineElement>("#guide-line");
const guideTick = document.querySelector<SVGLineElement>("#guide-tick");
const heightLabelEl = document.querySelector<HTMLElement>("#height-label");

const comparisonCaptionEl = document.querySelector<HTMLElement>("#comparison-caption");
const sceneImgEls = document.querySelectorAll<HTMLImageElement>(".scene-img");
const comparisonBubbleEl = document.querySelector<HTMLElement>("#comparison-bubble");
const comparisonGlowEl = document.querySelector<HTMLElement>("#comparison-glow");

const foldButton = document.querySelector<HTMLButtonElement>("#fold-button");
const foldNoteEl = document.querySelector<HTMLElement>("#fold-note");
const foldCountEl = document.querySelector<HTMLElement>("#fold-count");
const thicknessEl = document.querySelector<HTMLElement>("#thickness");

const limitPromptEl = document.querySelector<HTMLElement>("#limit-prompt");
const limitBubbleEl = document.querySelector<HTMLElement>("#limit-bubble");
const stopRealButton = document.querySelector<HTMLButtonElement>("#stop-real");
const keepGoingButton = document.querySelector<HTMLButtonElement>("#keep-going");

const stoppedPanelEl = document.querySelector<HTMLElement>("#stopped-panel");
const foldFreshButton = document.querySelector<HTMLButtonElement>("#fold-fresh");
const chooseDifferentButton = document.querySelector<HTMLButtonElement>("#choose-different");

let preset: PaperPreset = getPreset("a4");
let foldCount = 0;
let isAnimating = false;
let stopped = false;
let physicsIgnored = false;
let limitShown = false;
let ended = false;

// Stage C zoom state — see CAMERA_ZOOM_STEP above and updateCameraZoomLevel
// below. inStageCZoom is read by render()'s caller (the fold handler) to
// decide whether to append the subtle "camera pulls back" cue to the scene
// caption; it's only meaningful for the fold that was just rendered.
let zoomTrackedFoldCount = -1;
let zoomTrackedObjectId: string | null = null;
let cameraZoomLevel = 1;
let inStageCZoom = false;

// Only actually steps cameraZoomLevel once per fold (guarded by
// zoomTrackedFoldCount) since render() can in principle be called more than
// once for the same foldCount (e.g. a resize) without that counting as
// further pull-back.
function updateCameraZoomLevel(objectId: string, stuck: boolean): number {
  if (foldCount !== zoomTrackedFoldCount) {
    if (objectId !== zoomTrackedObjectId) {
      cameraZoomLevel = 1;
    } else if (stuck) {
      cameraZoomLevel = Math.max(MIN_CAMERA_ZOOM, cameraZoomLevel * CAMERA_ZOOM_STEP);
    }
    zoomTrackedFoldCount = foldCount;
    zoomTrackedObjectId = objectId;
  }
  return cameraZoomLevel;
}

// Stage B/C reference-scale easing state — see referenceDecay's comment on
// SceneObject. Tracked the same way as cameraZoomLevel above (reset the
// moment the closest object changes, stepped at most once per fold), but
// this is a per-object *feature* rather than a global mechanism: it only
// steps away from the exact naiveScale for whichever object sets
// referenceDecay (currently just Alpha Centauri) — every other object gets
// easedReferenceScale === naiveScale on every fold, an exact no-op.
let referenceEaseTrackedFoldCount = -1;
let referenceEaseTrackedObjectId: string | null = null;
let easedReferenceScale = 1;

function updateEasedReferenceScale(
  objectId: string,
  naiveScale: number,
  decay: number | undefined,
): number {
  if (foldCount !== referenceEaseTrackedFoldCount) {
    if (objectId !== referenceEaseTrackedObjectId || decay === undefined) {
      // A fresh object (or one with no decay configured) always gets the
      // mathematically exact ratio directly — no easing to carry over.
      easedReferenceScale = naiveScale;
    } else {
      // Ease toward naiveScale by at most a factor of `decay` per fold,
      // never *below* the exact ratio (Math.max) — so this only ever slows
      // the shrink down, it never makes the reference bigger than its own
      // previous fold's value nor smaller than the true ratio demands.
      easedReferenceScale = Math.max(naiveScale, easedReferenceScale * decay);
    }
    referenceEaseTrackedFoldCount = foldCount;
    referenceEaseTrackedObjectId = objectId;
  }
  return clamp(easedReferenceScale, MIN_REFERENCE_SCALE, 1);
}

function closestReference(heightMm: number): SceneObjectWithScene {
  // Every object without minActivationMm is always a candidate, so this can
  // never be empty.
  const candidates = ALL_OBJECTS.filter(
    (obj) => obj.minActivationMm === undefined || heightMm >= obj.minActivationMm,
  );
  return candidates.reduce((best, obj) =>
    Math.abs(Math.log(heightMm) - Math.log(obj.heightMm)) <
    Math.abs(Math.log(heightMm) - Math.log(best.heightMm))
      ? obj
      : best,
  );
}

function comparisonCaption(heightMm: number, closest: SceneObjectWithScene): string {
  const tallest = ALL_OBJECTS[ALL_OBJECTS.length - 1];
  if (heightMm > tallest.heightMm * 1.3) {
    return `already taller than <strong>${tallest.label}</strong>`;
  }
  // The paper can clearly surpass its *current* closest object (not just the
  // overall tallest) while still being nearer to it than to the next one up
  // — e.g. at fold 27 the paper is already ~1.5x Mount Everest. "About as
  // tall as" would undersell that, so switch wording once it's a clear lead
  // rather than a close comparison.
  if (heightMm > closest.heightMm * 1.3) {
    return `already taller than <strong>${closest.label}</strong>`;
  }
  return `about as tall as <strong>${closest.label}</strong>`;
}

// A short, friendly line for the annotation bubble — object name, its
// approximate height in the same units the readout already uses, and the
// one-line fact from the scene data.
function comparisonBubbleText(obj: SceneObjectWithScene): string {
  if (obj.bubbleText) return obj.bubbleText;
  const name = obj.label.charAt(0).toUpperCase() + obj.label.slice(1);
  return `${name} — about ${formatThickness(obj.heightMm)} tall. ${obj.fact}`;
}

// The camera's job: given a scale factor (k, viewBox units per real
// millimetre) and the mm-equivalent of the current view span, size the
// ground line to match. k itself is worked out by the caller — see
// render() — from the active scene's calibration.
//
// #camera itself only translates and flips Y now — it deliberately does NOT
// carry the k zoom as an SVG transform. At Earth-and-beyond scale, k shrinks
// to ~1e-9 and raw world-mm coordinates (ground line half-length, paper
// stack extents) run into the hundreds of millions or billions; Chromium's
// SVG geometry pipeline silently clamps coordinates that large to roughly
// LayoutUnit::Max() (~33.55 million user units) *before* applying a group's
// scale transform, which is what made the folded-paper indicator collapse
// to sub-pixel size once the story reached Earth. Pre-multiplying every
// coordinate by k in JS (here, and in renderStack) keeps the numbers that
// actually land in the DOM bounded to roughly TARGET_SPAN's own small
// magnitude, however extreme the real-world scale gets, so nothing is ever
// large enough to hit that clamp. The flat sheet (renderFlatSheet) never
// reaches these magnitudes — it's only ever shown before the first fold —
// so it keeps its original raw-mm coordinates, zoomed by the separate
// #paper-flat-zoom inner group instead.
function updateCamera(k: number, worldHeightMm: number): void {
  cameraEl?.setAttribute("transform", `translate(${CAMERA_X} ${CAMERA_Y}) scale(1 -1)`);
  paperFlatZoomEl?.setAttribute("transform", `scale(${k} ${k})`);

  const groundHalf = worldHeightMm * 3 * k;
  groundLineEl?.setAttribute("x1", (-groundHalf).toString());
  groundLineEl?.setAttribute("x2", groundHalf.toString());
}

// Shows exactly one scene image (crossfaded via CSS opacity transitions),
// with the annotation bubble and spotlight glow tracking whichever object
// in that scene is the current closest match.
function renderComparisonScene(
  closest: SceneObjectWithScene,
  thicknessMm: number,
  naturalRect: DOMRect | undefined,
  referenceScale: number,
): void {
  sceneImgEls.forEach((img) => {
    img.classList.toggle("is-active", img.dataset.scene === closest.sceneId);
  });

  document.body.dataset.theme = SCENE_THEME[closest.sceneId] ?? "everyday";

  if (comparisonCaptionEl) {
    comparisonCaptionEl.innerHTML = comparisonCaption(thicknessMm, closest);
  }

  // The bubble is a fixed annotation card outside the drawing area (see
  // .comparison-bubble in styles.css) — it no longer follows the object
  // around the scene. Only the leader-line arrow (updateLeaderLine, below)
  // points at it.
  if (comparisonBubbleEl) {
    comparisonBubbleEl.textContent = comparisonBubbleText(closest);
  }

  if (comparisonGlowEl) {
    comparisonGlowEl.style.setProperty("--anchor-x", `${closest.anchorXPct}%`);
    comparisonGlowEl.style.setProperty("--anchor-y", `${closest.anchorYPct}%`);

    const { lineFromXPct, lineToXPct } = closest;
    const isLine = lineFromXPct !== undefined && lineToXPct !== undefined;
    comparisonGlowEl.classList.toggle("is-line", isLine);
    if (lineFromXPct !== undefined && lineToXPct !== undefined) {
      const left = Math.min(lineFromXPct, lineToXPct);
      const width = Math.abs(lineToXPct - lineFromXPct);
      comparisonGlowEl.style.setProperty("--line-left", `${left}%`);
      comparisonGlowEl.style.setProperty("--line-width", `${width}%`);
    }
  }

  updateLeaderLine(closest, naturalRect, referenceScale);
}

// Converts a point in screen (client) pixels into #world-svg's own user-space
// (viewBox) coordinates, using the SVG's actual rendered transform — this is
// exact regardless of letterboxing from preserveAspectRatio or the world's
// own padding, so it needs no manual aspect-ratio bookkeeping.
function screenPointToViewBox(svg: SVGSVGElement, clientX: number, clientY: number): DOMPoint {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const ctm = svg.getScreenCTM();
  return ctm ? point.matrixTransform(ctm.inverse()) : point;
}

// .scene-stage transitions its `transform` (styles.css), so a synchronous
// getBoundingClientRect() read taken right after changing that property (or
// clearing it) reflects whatever was on screen a moment ago, not the value
// just set — a CSS transition only starts interpolating on the next
// rendering update, not synchronously within this script. Forcing
// transition:none makes the clear-and-measure step land instantly and
// accurately; putting the previous transform straight back (still
// instantly, before this function returns, and before the browser gets a
// chance to paint anything in between) means nothing is ever actually shown
// in the reset state — the real transform change render() makes later in
// the same pass is what the user sees animate.
function measureStageNaturalRect(): DOMRect | undefined {
  if (!sceneStageEl) return undefined;
  const prevTransform = sceneStageEl.style.transform;
  const prevTransition = sceneStageEl.style.transition;
  sceneStageEl.style.transition = "none";
  sceneStageEl.style.removeProperty("transform");
  void sceneStageEl.offsetHeight;
  const rect = sceneStageEl.getBoundingClientRect();
  sceneStageEl.style.transform = prevTransform;
  void sceneStageEl.offsetHeight;
  sceneStageEl.style.transition = prevTransition;
  return rect;
}

// Maps a 0-1 (fx, fy) anchor in .scene-stage's own natural box into a live
// client-space point at a given target scale, replicating the CSS
// `transform: scale(scale)` with `transform-origin: 100% 100%` (bottom-right
// — matches .scene-stage's own inset anchor) analytically, rather than
// reading it back from the DOM. That's necessary, not just simpler: the
// scale about to be applied is mid-transition for most of its 550ms, so a
// synchronous rect read can't observe its settled target value either.
function stageAnchorToClientPoint(
  naturalRect: DOMRect,
  fx: number,
  fy: number,
  scale: number,
): { x: number; y: number } {
  const originX = naturalRect.left + naturalRect.width;
  const originY = naturalRect.top + naturalRect.height;
  const px = naturalRect.left + fx * naturalRect.width;
  const py = naturalRect.top + fy * naturalRect.height;
  return { x: originX + scale * (px - originX), y: originY + scale * (py - originY) };
}

// Measures .scene-stage's real rendered height, in #world-svg's own viewBox
// units, from a natural (unscaled) rect measured via measureStageNaturalRect
// — rather than trusting STAGE_HEIGHT_VB's analytical derivation from CSS
// percentages/aspect-ratios, which drifts out of sync with reality whenever
// padding, box-sizing, or preserveAspectRatio letterboxing isn't exactly
// what the formula assumes. Falls back to the static estimate only if the
// elements aren't laid out yet.
function measureStageHeightVB(naturalRect: DOMRect | undefined): number {
  if (!naturalRect || !worldSvgEl) return STAGE_HEIGHT_VB;
  if (naturalRect.height === 0) return STAGE_HEIGHT_VB;

  const top = screenPointToViewBox(worldSvgEl, naturalRect.left, naturalRect.top);
  const bottom = screenPointToViewBox(worldSvgEl, naturalRect.left, naturalRect.bottom);
  return Math.abs(bottom.y - top.y);
}

// Pins .scene-stage's bottom edge to the ground line's actual on-screen
// position, measured live, rather than a second independently-tuned CSS
// percentage. The ground line's screen Y is fixed at CAMERA_Y fraction down
// #world-svg's own content box (the camera's translate never changes), so
// this is the one groundY value both the line and every comparison object's
// bottom now share — instead of drifting apart at sizes the hand-picked CSS
// percentage wasn't tuned against.
function alignGroundBaseline(): void {
  if (!worldEl || !worldSvgEl || !sceneStageEl) return;
  const worldRect = worldEl.getBoundingClientRect();
  const svgRect = worldSvgEl.getBoundingClientRect();
  if (svgRect.height === 0) return;

  const groundScreenY = svgRect.top + (CAMERA_Y / WORLD_VIEWBOX_HEIGHT) * svgRect.height;
  sceneStageEl.style.bottom = `${worldRect.bottom - groundScreenY}px`;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// Aims the doodle-style leader-line arrow from the annotation card (now
// outside .world entirely — see .scene-frame in styles.css) to wherever the
// active comparison object actually sits in its scene photo right now. The
// path lives in #world-svg but outside #camera (and the SVG has overflow:
// visible), so it isn't panned/zoomed with the paper, and can freely start
// from a point outside the SVG's own viewBox — only its endpoints and curve
// are recomputed, each frame.
function updateLeaderLine(
  closest: SceneObjectWithScene,
  naturalRect: DOMRect | undefined,
  referenceScale: number,
): void {
  if (!worldSvgEl || !leaderLineEl || !comparisonBubbleEl || !naturalRect) return;

  const objectPoint = stageAnchorToClientPoint(
    naturalRect,
    closest.anchorXPct / 100,
    closest.anchorYPct / 100,
    referenceScale,
  );
  const objectClientX = objectPoint.x;
  const objectClientY = objectPoint.y;

  // Start from whichever point on the card's own border is closest to the
  // object, so the arrow leaves from the edge that actually faces it — the
  // right edge when the card sits beside .world, the top edge when it's
  // stacked below on narrow viewports — without hard-coding either layout.
  const bubbleRect = comparisonBubbleEl.getBoundingClientRect();
  const bubbleClientX = clamp(objectClientX, bubbleRect.left, bubbleRect.right);
  const bubbleClientY = clamp(objectClientY, bubbleRect.top, bubbleRect.bottom);

  const start = screenPointToViewBox(worldSvgEl, bubbleClientX, bubbleClientY);
  const end = screenPointToViewBox(worldSvgEl, objectClientX, objectClientY);

  // Bow the line out to one side via two uneven control points, like a
  // hand-sketched arrow rather than a ruled ­one — a plain single-control
  // quadratic curve reads as a too-perfect parabola, whereas offsetting the
  // two cubic control points by different amounts along the line gives it
  // the slightly uneven arc of an actual pen stroke. The bow is derived from
  // the endpoints themselves (not randomised), so it stays stable across
  // re-renders and only changes when the object or layout actually does.
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const bow = Math.min(22, length * 0.3);
  const nx = -dy / length;
  const ny = dx / length;
  const control1X = start.x + dx * 0.32 + nx * bow;
  const control1Y = start.y + dy * 0.32 + ny * bow;
  const control2X = start.x + dx * 0.68 + nx * bow * 0.55;
  const control2Y = start.y + dy * 0.68 + ny * bow * 0.55;

  leaderLineEl.setAttribute(
    "d",
    `M ${start.x} ${start.y} C ${control1X} ${control1Y} ${control2X} ${control2Y} ${end.x} ${end.y}`,
  );
}

function renderFlatSheet(worldHeightMm: number): void {
  const scale = FLAT_WIDTH_SCALE[preset.id] ?? 1;
  const width = FLAT_BASE_WIDTH_MM * scale;
  const halfWidth = width / 2;
  const paperX = PAPER_X_FRACTION * worldHeightMm;
  const x = paperX - halfWidth;

  flatLeftEl?.setAttribute("x", x.toString());
  flatLeftEl?.setAttribute("width", halfWidth.toString());
  flatRightEl?.setAttribute("x", paperX.toString());
  flatRightEl?.setAttribute("width", halfWidth.toString());
  flatShadow?.setAttribute("x", (x + 1.2).toString());
  flatShadow?.setAttribute("y", "-1.2");
  flatShadow?.setAttribute("width", width.toString());
  flatShadow?.setAttribute("height", FLAT_BAND_HEIGHT_MM.toString());
  foldCrease?.setAttribute("x1", paperX.toString());
  foldCrease?.setAttribute("x2", paperX.toString());
}

// All coordinates below are computed in world millimetres (same as before)
// but multiplied by k before being written to the DOM — see updateCamera's
// comment for why: past Earth scale these mm values run into the hundreds
// of millions or billions, which is large enough for Chromium's SVG geometry
// pipeline to clamp them, and pre-scaling here keeps every number actually
// set on an attribute safely small regardless of scene.
function renderStack(worldHeightMm: number, k: number): number {
  const thicknessMm = thicknessAfterFolds(foldCount, preset.thicknessMm);
  const drawnHeight = Math.max(thicknessMm, worldHeightMm * MIN_VISUAL_FRACTION);
  const width = Math.max(
    worldHeightMm * STACK_MIN_WIDTH_FRACTION,
    worldHeightMm * STACK_BASE_WIDTH_FRACTION * STACK_WIDTH_SHRINK_FACTOR ** foldCount,
  );
  const paperX = PAPER_X_FRACTION * worldHeightMm;
  const x = paperX - width / 2;

  stackOutline?.setAttribute("x", (x * k).toString());
  stackOutline?.setAttribute("width", (width * k).toString());
  stackOutline?.setAttribute("height", (drawnHeight * k).toString());
  stackShadow?.setAttribute("x", ((x + 1.2) * k).toString());
  stackShadow?.setAttribute("width", (width * k).toString());
  stackShadow?.setAttribute("height", (drawnHeight * k).toString());

  const guideX = paperX + width / 2 + Math.max(4, worldHeightMm * 0.04);
  guideLine?.setAttribute("x1", (guideX * k).toString());
  guideLine?.setAttribute("x2", (guideX * k).toString());
  guideLine?.setAttribute("y2", (drawnHeight * k).toString());
  guideTick?.setAttribute("y1", (drawnHeight * k).toString());
  guideTick?.setAttribute("y2", (drawnHeight * k).toString());
  guideTick?.setAttribute("x1", ((paperX + width / 2) * k).toString());
  guideTick?.setAttribute("x2", ((guideX + 4) * k).toString());

  return drawnHeight;
}

// Scales the whole reference scene (the photo plus its glow, which is a
// child of #scene-stage) down as one unit once the paper has pinned at its
// ceiling — never crops, repositions, or independently resizes anything
// inside the image, so whichever object is annotated stays exactly where it
// was in the frame, just smaller. transform-origin: 100% 100% (set in CSS)
// matches .scene-stage's own layout anchor (inset: auto 1rem <bottom> auto),
// so it shrinks toward the same bottom-right corner it's already pinned to
// instead of drifting across the canvas.
function renderReferenceScale(scale: number): void {
  if (!sceneStageEl) return;
  if (scale >= 1) {
    sceneStageEl.style.removeProperty("transform");
    return;
  }
  sceneStageEl.style.transform = `scale(${scale})`;
}

// Single render pass: recompute the camera, then everything that lives
// inside it, from the current fold count and preset.
function render(): void {
  const thicknessMm = thicknessAfterFolds(foldCount, preset.thicknessMm);

  // Measured once, up front, via the transition-proof helper — both this
  // frame's calibration (measureStageHeightVB) and its arrow placement
  // (renderComparisonScene -> updateLeaderLine) need the true natural size,
  // not whatever .scene-stage happens to be mid-transition to right now.
  const naturalRect = measureStageNaturalRect();

  const closest = closestReference(thicknessMm);
  const paperHeightForCamera = foldCount === 0 ? FLAT_BAND_HEIGHT_MM : thicknessMm;

  // Stage A: scale the paper so its on-screen height matches the closest
  // object's own on-screen height, at the same real-world proportion
  // (thicknessMm / closest.heightMm) — as long as that calibrated height
  // fits under MAX_PAPER_LOCAL_HEIGHT.
  //
  // Stage B: once it doesn't, hold the paper at that ceiling instead of
  // growing past it, and shrink the *reference* scene by exactly the factor
  // the paper is being held back by. That keeps expressing
  // thicknessMm / closest.heightMm — the same ratio Stage A shows — on every
  // single fold, instead of both sides freezing once the paper alone hits
  // its cap (the old min(kCalibrated, kFitPaper) behaviour).
  //
  // Stage C: Stage B's own reference floor (MIN_REFERENCE_SCALE) eventually
  // binds too, for any object the story lingers on long enough (in practice,
  // the Sun-Neptune distance, which stays "closest" for ~20 folds) — once it
  // does, holding both the paper and reference at their respective ceiling
  // and floor makes every following fold with that same object render
  // identically, even though thicknessMm keeps doubling. cameraZoomLevel
  // (see updateCameraZoomLevel) pulls the paper's own ceiling back a little
  // further each fold it stays stuck this way, so k keeps changing every
  // fold instead of freezing. It deliberately does NOT also multiply into
  // referenceScale: MIN_REFERENCE_SCALE is a floor precisely so a reference
  // that stays closest for a long run never shrinks to nothing (see its own
  // comment above) — over a long enough streak (Sun-Neptune for ~20 folds,
  // then the Milky Way for the last ~8 up to fold 90), multiplying it by a
  // strictly-decaying zoom defeated that floor and left the reference photo
  // an illegible speck. Pinning it at the floor keeps the reference legible
  // for the whole stuck streak; k shrinking is enough on its own to keep the
  // scene visibly alive every fold.
  const stageHeightVB = measureStageHeightVB(naturalRect);
  const kCalibrated = ((closest.heightPct / 100) * stageHeightVB) / closest.heightMm;
  const calibratedPaperHeight = paperHeightForCamera * kCalibrated;
  const overCeiling = calibratedPaperHeight > MAX_PAPER_LOCAL_HEIGHT;
  const naiveReferenceScale = MAX_PAPER_LOCAL_HEIGHT / calibratedPaperHeight;
  const stuckInStageC = overCeiling && naiveReferenceScale < MIN_REFERENCE_SCALE;
  const zoom = updateCameraZoomLevel(closest.id, stuckInStageC);
  inStageCZoom = stuckInStageC;

  const k = stuckInStageC
    ? (MAX_PAPER_LOCAL_HEIGHT * zoom) / paperHeightForCamera
    : overCeiling
      ? MAX_PAPER_LOCAL_HEIGHT / paperHeightForCamera
      : kCalibrated;
  // For every object without referenceDecay this is exactly
  // clamp(naiveReferenceScale, MIN_REFERENCE_SCALE, 1) on every fold —
  // identical to the old stuckInStageC/overCeiling branching above, since
  // naiveReferenceScale >= 1 whenever !overCeiling and < MIN_REFERENCE_SCALE
  // whenever stuckInStageC. Only a referenceDecay-carrying object (Alpha
  // Centauri) actually eases more slowly than that exact ratio — see
  // updateEasedReferenceScale.
  const referenceScale = updateEasedReferenceScale(
    closest.id,
    naiveReferenceScale,
    closest.referenceDecay,
  );

  const worldHeightMm = TARGET_SPAN / k;
  updateCamera(k, worldHeightMm);
  alignGroundBaseline();
  renderReferenceScale(referenceScale);

  renderFlatSheet(worldHeightMm);
  if (foldCount > 0) renderStack(worldHeightMm, k);
  renderComparisonScene(closest, thicknessMm, naturalRect, referenceScale);

  if (foldCountEl) foldCountEl.textContent = foldCount.toString();
  if (thicknessEl) thicknessEl.textContent = formatThickness(thicknessMm);
  if (heightLabelEl) heightLabelEl.textContent = formatThickness(thicknessMm);
}

// The bubble names the actual thickness at the moment this particular
// sheet hits its own practical limit — small in the maths, big in the
// hands — so it reads differently for a thin newspaper sheet than for a
// thick "large sheet" preset, instead of quoting one fixed number.
function limitBubbleText(thicknessMm: number): string {
  return `Funny, right? It's still only ${formatThickness(thicknessMm)} thick — but real paper's already fighting back.`;
}

function checkPhysicalLimit(): void {
  if (!foldButton) return;

  if (stopped) {
    foldButton.disabled = true;
    return;
  }

  if (!physicsIgnored) {
    const limit = physicalFoldLimit(preset);
    if (foldCount >= limit) {
      if (!limitShown) {
        limitShown = true;
        if (limitBubbleEl) {
          limitBubbleEl.textContent = limitBubbleText(
            thicknessAfterFolds(foldCount, preset.thicknessMm),
          );
        }
        limitPromptEl?.removeAttribute("hidden");
      }
      foldButton.disabled = true;
      return;
    }
  }

  foldButton.disabled = false;
}

// Not a new modal — folding past MAX_FOLDS just stops advancing, fades the
// comparison scene a little, and swaps the Fold button's own label. The
// theme is already "space" by fold 90 in practice (Milky Way activates
// around fold 82, well before), but it's locked explicitly here too since
// this is the one state where nothing else keeps re-deriving it via render().
function enterEnding(): void {
  if (ended) return;
  ended = true;
  document.body.dataset.theme = "space";
  sceneEl?.classList.add("is-ended");
  endingCopyEl?.removeAttribute("hidden");
  if (foldButton) {
    foldButton.textContent = "Try again";
    foldButton.disabled = false;
  }
  if (foldNoteEl) foldNoteEl.textContent = "start over, from a single sheet";
}

// A full state reset, not a page reload — resetScene() is already the
// single source of truth every other "start over" path (preset pick,
// "try again" after the physical limit, changing sheets) goes through, so
// routing the ending's own reset through it too means every one of those
// paths also correctly clears the ended state if clicked while ended.
function exitEnding(): void {
  resetScene(preset);
}

function resetScene(nextPreset: PaperPreset): void {
  preset = nextPreset;
  foldCount = 0;
  isAnimating = false;
  stopped = false;
  physicsIgnored = false;
  limitShown = false;
  ended = false;
  cameraZoomLevel = 1;
  zoomTrackedFoldCount = -1;
  zoomTrackedObjectId = null;
  inStageCZoom = false;
  easedReferenceScale = 1;
  referenceEaseTrackedFoldCount = -1;
  referenceEaseTrackedObjectId = null;

  paperFlatEl?.removeAttribute("hidden");
  paperFlatEl?.classList.remove("is-folding");
  paperStackEl?.setAttribute("hidden", "");
  paperStackEl?.classList.remove("is-revealing", "is-flexing");

  limitPromptEl?.setAttribute("hidden", "");
  stoppedPanelEl?.setAttribute("hidden", "");
  sceneEl?.classList.remove("is-ended");
  endingCopyEl?.setAttribute("hidden", "");
  if (foldButton) foldButton.textContent = "Fold it";
  if (sceneCaptionEl) sceneCaptionEl.textContent = "a flat sheet, waiting to be folded";
  if (foldNoteEl) foldNoteEl.textContent = "go on, give it a fold";

  render();
  checkPhysicalLimit();
}

paperPicker?.showModal();

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.dataset.preset;
    if (!id) return;
    paperPicker?.close();
    resetScene(getPreset(id));
  });
});

changeSheetButton?.addEventListener("click", () => {
  if (isAnimating) return;
  paperPicker?.showModal();
});

foldButton?.addEventListener("click", () => {
  // Once ended, this is the only click target left visible ("Try again")
  // and it never re-enters the normal fold path below — foldCount is never
  // incremented past MAX_FOLDS, so fold 91 is architecturally unreachable
  // rather than merely disabled.
  if (ended) {
    exitEnding();
    return;
  }
  if (isAnimating || stopped || !foldButton) return;

  isAnimating = true;
  foldButton.disabled = true;
  const isFirstFold = foldCount === 0;
  foldCount += 1;

  const settle = () => {
    render();
    if (sceneCaptionEl) {
      let caption = isFirstFold ? "folded once — watch it stack up" : `folded ${foldCount} times`;
      if (inStageCZoom) caption += " — the camera pulls back a little further";
      sceneCaptionEl.textContent = caption;
    }
    isAnimating = false;
    if (foldCount >= MAX_FOLDS) {
      enterEnding();
    } else {
      checkPhysicalLimit();
    }
  };

  if (reduceMotion) {
    if (isFirstFold) {
      paperFlatEl?.setAttribute("hidden", "");
      paperStackEl?.removeAttribute("hidden");
    }
    settle();
    return;
  }

  if (isFirstFold) {
    if (sceneCaptionEl) sceneCaptionEl.textContent = "the paper folds in on itself…";
    paperFlatEl?.classList.add("is-folding");
    window.setTimeout(() => {
      paperFlatEl?.setAttribute("hidden", "");
      paperFlatEl?.classList.remove("is-folding");
      paperStackEl?.removeAttribute("hidden");
      paperStackEl?.classList.add("is-revealing");
      render();
      window.setTimeout(() => {
        paperStackEl?.classList.remove("is-revealing");
        settle();
      }, STACK_REVEAL_MS);
    }, FOLD_FLIP_MS);
  } else {
    paperStackEl?.classList.add("is-flexing");
    render();
    window.setTimeout(() => {
      paperStackEl?.classList.remove("is-flexing");
      settle();
    }, FLEX_MS);
  }
});

stopRealButton?.addEventListener("click", () => {
  stopped = true;
  limitPromptEl?.setAttribute("hidden", "");
  stoppedPanelEl?.removeAttribute("hidden");
  if (sceneCaptionEl) {
    sceneCaptionEl.textContent = "staying real — this sheet's practical limit, for now";
  }
  if (foldNoteEl) foldNoteEl.textContent = "real paper is putting up a fight here";
  checkPhysicalLimit();
});

keepGoingButton?.addEventListener("click", () => {
  physicsIgnored = true;
  limitPromptEl?.setAttribute("hidden", "");
  if (sceneCaptionEl) {
    sceneCaptionEl.textContent = "now just a thought experiment — following the doubling anyway";
  }
  if (foldNoteEl) foldNoteEl.textContent = "keep folding, hypothetically";
  checkPhysicalLimit();
});

foldFreshButton?.addEventListener("click", () => {
  stoppedPanelEl?.setAttribute("hidden", "");
  resetScene(preset);
});

chooseDifferentButton?.addEventListener("click", () => {
  stoppedPanelEl?.setAttribute("hidden", "");
  paperPicker?.showModal();
});

// The leader-line's endpoints are read from live layout (getBoundingClientRect),
// so a viewport/orientation change needs a re-render to stay aimed correctly.
window.addEventListener("resize", render);

resetScene(preset);
