'use strict';

const API_BASE   = 'https://api.p-lod.org';
const DEFAULT_ID = 'urn:p-lod:id:pompeii';

// Types that have spatial geometry and spatial children
const SPATIAL_TYPES = new Set([
  'urn:p-lod:id:city',
  'urn:p-lod:id:region',
  'urn:p-lod:id:property',
  'urn:p-lod:id:street',
  'urn:p-lod:id:insula',
  'urn:p-lod:id:space',
  'urn:p-lod:id:garden',
  'urn:p-lod:id:feature',
]);

// Human-readable labels for common RDF predicates
const PREDICATE_LABELS = {
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type':   'Type',
  'http://www.w3.org/2000/01/rdf-schema#label':        'Label',
  'http://www.w3.org/2000/01/rdf-schema#comment':      'Comment',
  'http://www.w3.org/2004/02/skos/core#prefLabel':     'Preferred label',
  'http://www.w3.org/2004/02/skos/core#altLabel':      'Alternate label',
  'http://www.w3.org/2004/02/skos/core#definition':    'Definition',
  'urn:p-lod:id:description':   'Description',
  'urn:p-lod:id:is-part-of':    'Is part of',
  'urn:p-lod:id:p-in-p-url':    'Pompeii in Pictures',
  'urn:p-lod:id:wikidata-url':  'Wikidata',
  'urn:p-lod:id:wiki-en-url':   'Wikipedia (EN)',
  'urn:p-lod:id:wiki-it-url':   'Wikipedia (IT)',
  'urn:p-lod:id:pleiades-url':  'Pleiades',
  'urn:p-lod:id:getty-lod-url': 'Getty LOD',
};

// Predicates omitted from the info table (handled separately or not display-useful)
const SKIP_PREDICATES = new Set([
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  'urn:p-lod:id:geojson',
  'urn:p-lod:id:best-image',
]);

const TYPEAHEAD_SOURCE_TYPES = ['concept', 'region', 'insula', 'property'];
const TYPEAHEAD_SHOW_ID_TYPES = new Set(['region', 'insula', 'property']);
const TYPEAHEAD_MAX_SUGGESTIONS = 64;
const TYPEAHEAD_DEBOUNCE_MS = 120;
const TYPEAHEAD_CACHE_MS = 5 * 60 * 1000;
const IMAGE_HOVER_INTENT_DELAY_MS = 180;
const LUNA_BASE_URL = 'https://umassamherst.lunaimaging.com';
const IMAGE_MODAL_CAPTION_PREDICATE = 'urn:p-lod:id:x-luna-description';
const LUNA_RECORD_ID_PREDICATE = 'urn:p-lod:id:x-luna-record-id';
const LUNA_MEDIA_ID_PREDICATE  = 'urn:p-lod:id:x-luna-media-id';

const typeaheadState = {
  suggestions: [],
  resolveMap: new Map(),
  loadedAt: 0,
  loadingPromise: null,
};

const PANE_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const PANE_CONTENT_TYPES = {
  INFO: 'info',
  MAP: 'map',
  IMAGES: 'images',
  HIERARCHY_PLACEHOLDER: 'hierarchy-placeholder',
};

const DEFAULT_PANE_LAYOUT = Object.freeze({
  'top-left': PANE_CONTENT_TYPES.INFO,
  'top-right': PANE_CONTENT_TYPES.MAP,
  'bottom-left': PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER,
  'bottom-right': PANE_CONTENT_TYPES.IMAGES,
});

const LAYOUT_DEFAULTS_BY_RESOURCE_PROFILE = Object.freeze({
  default: DEFAULT_PANE_LAYOUT,
  concept: {
    'top-left': PANE_CONTENT_TYPES.INFO,
    'top-right': PANE_CONTENT_TYPES.MAP,
    'bottom-left': PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER,
    'bottom-right': PANE_CONTENT_TYPES.IMAGES,
  },
  spatial: {
    'top-left': PANE_CONTENT_TYPES.INFO,
    'top-right': PANE_CONTENT_TYPES.MAP,
    'bottom-left': PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER,
    'bottom-right': PANE_CONTENT_TYPES.IMAGES,
  },
});

const PANE_CONTENT_META = Object.freeze({
  [PANE_CONTENT_TYPES.INFO]: { label: 'Info' },
  [PANE_CONTENT_TYPES.MAP]: { label: 'Map' },
  [PANE_CONTENT_TYPES.IMAGES]: { label: 'Images' },
  [PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER]: { label: 'Hierarchy' },
});

let currentPaneLayout = { ...DEFAULT_PANE_LAYOUT };
let currentPaneLayoutOverride = null;
let currentResourceProfile = 'default';

// ── Inter-pane event bus ──────────────────────────────────────────────────────

const PANE_EVENT_ENTITY_HIGHLIGHT = 'entity:highlight';
const PANE_EVENT_ENTITY_CLEAR     = 'entity:clear';
const UI_EVENT_IMAGE_MODAL_OPEN   = 'image-modal:open';
const UI_EVENT_IMAGE_MODAL_CLOSE  = 'image-modal:close';

const paneEvents = (() => {
  const handlers = new Map();
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    },
    off(event, fn) {
      if (handlers.has(event)) handlers.get(event).delete(fn);
    },
    emit(event, data) {
      if (handlers.has(event)) handlers.get(event).forEach(fn => fn(data));
    },
  };
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

function normalizeId(raw) {
  const s = (raw || '').trim();
  if (!s) return DEFAULT_ID;
  if (s.startsWith('urn:p-lod:id:')) return s;
  return 'urn:p-lod:id:' + s;
}

function extractShortId(urn) {
  return String(urn).replace(/^urn:p-lod:id:/, '');
}

function humanizePredicate(uri) {
  if (PREDICATE_LABELS[uri]) return PREDICATE_LABELS[uri];
  const m = String(uri).match(/[#/]([^#/]+)$/);
  if (m) return m[1].replace(/-/g, ' ');
  return uri;
}

function isHttpUrl(val) {
  return typeof val === 'string' && /^https?:\/\//.test(val);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

// Flatten /id/ response (array of single-key dicts) into { predicate: [values] }
function flattenTriples(data) {
  const map = {};
  if (!Array.isArray(data)) return map;
  for (const dict of data) {
    const entries = Object.entries(dict);
    if (!entries.length) continue;
    const [key, val] = entries[0];
    if (!map[key]) map[key] = [];
    map[key].push(val);
  }
  return map;
}

function parseGeoJson(gjStr) {
  if (!gjStr || gjStr === 'None') return null;
  try {
    return typeof gjStr === 'string' ? JSON.parse(gjStr) : gjStr;
  } catch (_) {
    return null;
  }
}

function debounce(fn, waitMs) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), waitMs);
  };
}

function normalizeTypeaheadRecord(item, sourceType) {
  if (!item || !item.urn) return null;

  const shortId = extractShortId(item.urn).trim();
  if (!shortId) return null;

  let itemType = sourceType;
  if (item.type && String(item.type).startsWith('urn:p-lod:id:')) {
    itemType = extractShortId(item.type);
  }

  const label = (typeof item.label === 'string' && item.label.trim())
    ? item.label.trim()
    : null;

  return { shortId, label, type: itemType };
}

function addTypeaheadSuggestion(target, seenValues, value, shortId, type) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return;

  const dedupeKey = cleanValue.toLowerCase();
  if (seenValues.has(dedupeKey)) return;

  seenValues.add(dedupeKey);
  target.push({ value: cleanValue, shortId, type });
}

async function fetchInstancesOfType(sourceType) {
  try {
    const r = await fetch(`${API_BASE}/instances-of/${encodeURIComponent(sourceType)}`);
    if (!r.ok) return [];
    const payload = await r.json();
    return Array.isArray(payload) ? payload : [];
  } catch (_) {
    return [];
  }
}

function rebuildTypeaheadIndex(instanceListsByType) {
  const byShortId = new Map();

  for (const { sourceType, items } of instanceListsByType) {
    for (const item of (items || [])) {
      const normalized = normalizeTypeaheadRecord(item, sourceType);
      if (!normalized) continue;

      const existing = byShortId.get(normalized.shortId);
      if (!existing) {
        byShortId.set(normalized.shortId, normalized);
        continue;
      }

      // Prefer whichever record provides a label if duplicates appear.
      if (!existing.label && normalized.label) {
        existing.label = normalized.label;
        existing.type = normalized.type;
      }
    }
  }

  const ordered = Array.from(byShortId.values()).sort((a, b) => a.shortId.localeCompare(b.shortId));
  const resolveMap = new Map();
  const suggestions = [];
  const seenSuggestionValues = new Set();

  for (const rec of ordered) {
    const shortLower = rec.shortId.toLowerCase();
    resolveMap.set(shortLower, rec.shortId);
    resolveMap.set(`urn:p-lod:id:${rec.shortId}`.toLowerCase(), rec.shortId);

    if (rec.label) {
      const labelLower = rec.label.toLowerCase();
      if (!resolveMap.has(labelLower)) {
        resolveMap.set(labelLower, rec.shortId);
      }
      addTypeaheadSuggestion(suggestions, seenSuggestionValues, rec.label, rec.shortId, rec.type);
    }

    const shouldShowShortId = !rec.label || TYPEAHEAD_SHOW_ID_TYPES.has(rec.type);
    if (shouldShowShortId) {
      addTypeaheadSuggestion(suggestions, seenSuggestionValues, rec.shortId, rec.shortId, rec.type);
    }
  }

  typeaheadState.suggestions = suggestions;
  typeaheadState.resolveMap = resolveMap;
  typeaheadState.loadedAt = Date.now();
}

function isTypeaheadCacheFresh() {
  return !!typeaheadState.loadedAt && (Date.now() - typeaheadState.loadedAt) < TYPEAHEAD_CACHE_MS;
}

async function ensureTypeaheadLoaded(forceRefresh = false) {
  if (!forceRefresh && isTypeaheadCacheFresh()) return;

  if (typeaheadState.loadingPromise) {
    await typeaheadState.loadingPromise;
    return;
  }

  typeaheadState.loadingPromise = (async () => {
    const results = await Promise.all(
      TYPEAHEAD_SOURCE_TYPES.map(async sourceType => ({
        sourceType,
        items: await fetchInstancesOfType(sourceType),
      }))
    );
    rebuildTypeaheadIndex(results);
  })();

  try {
    await typeaheadState.loadingPromise;
  } finally {
    typeaheadState.loadingPromise = null;
  }
}

function rankTypeaheadSuggestion(entry, queryLower) {
  const valueLower = entry.value.toLowerCase();
  const shortLower = entry.shortId.toLowerCase();

  if (valueLower === queryLower || shortLower === queryLower) return 0;
  if (valueLower.startsWith(queryLower)) return 1;
  if (shortLower.startsWith(queryLower)) return 2;
  if (valueLower.includes(queryLower)) return 3;
  if (shortLower.includes(queryLower)) return 4;
  return 99;
}

function getTypeaheadSuggestions(query) {
  const queryLower = String(query || '').trim().toLowerCase();
  if (!queryLower) return [];

  const matches = [];
  for (const entry of typeaheadState.suggestions) {
    const score = rankTypeaheadSuggestion(entry, queryLower);
    if (score < 99) {
      matches.push({ entry, score });
    }
  }

  matches.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.entry.value.localeCompare(b.entry.value);
  });

  return matches.slice(0, TYPEAHEAD_MAX_SUGGESTIONS).map(m => m.entry);
}

function renderTypeaheadSuggestions(rawQuery, datalistEl) {
  if (!datalistEl) return;
  const suggestions = getTypeaheadSuggestions(rawQuery);
  datalistEl.innerHTML = suggestions
    .map(s => `<option value="${escAttr(s.value)}"></option>`)
    .join('');
}

function resolveSearchInputToId(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) return DEFAULT_ID;

  const mapped = typeaheadState.resolveMap.get(input.toLowerCase());
  return mapped || input;
}

function isTypeaheadSelectionEvent(evt) {
  return typeof InputEvent !== 'undefined'
    && evt instanceof InputEvent
    && evt.inputType === 'insertReplacementText';
}

function clonePaneLayout(layout) {
  return {
    'top-left': layout['top-left'],
    'top-right': layout['top-right'],
    'bottom-left': layout['bottom-left'],
    'bottom-right': layout['bottom-right'],
  };
}

function isKnownPaneContentType(contentType) {
  return Object.prototype.hasOwnProperty.call(PANE_CONTENT_META, contentType);
}

function isValidPaneLayout(layout) {
  if (!layout || typeof layout !== 'object') return false;

  const used = new Set();
  for (const pos of PANE_POSITIONS) {
    const contentType = layout[pos];
    if (!isKnownPaneContentType(contentType)) return false;
    if (used.has(contentType)) return false;
    used.add(contentType);
  }

  return used.size === PANE_POSITIONS.length;
}

function normalizePaneLayout(layout, fallbackLayout = DEFAULT_PANE_LAYOUT) {
  if (!isValidPaneLayout(layout)) return clonePaneLayout(fallbackLayout);
  return clonePaneLayout(layout);
}

function encodePaneLayout(layout) {
  return PANE_POSITIONS.map(pos => `${pos}:${layout[pos]}`).join(',');
}

function parsePaneLayout(raw) {
  if (!raw) return null;

  const out = {};
  const pairs = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const idx = pair.indexOf(':');
    if (idx < 1) return null;

    const pos = pair.slice(0, idx).trim();
    const contentType = pair.slice(idx + 1).trim();
    if (!PANE_POSITIONS.includes(pos)) return null;
    out[pos] = contentType;
  }

  return isValidPaneLayout(out) ? clonePaneLayout(out) : null;
}

function resolveResourceProfile(typeUrn) {
  if (SPATIAL_TYPES.has(typeUrn)) return 'spatial';
  if (typeUrn === 'urn:p-lod:id:concept') return 'concept';
  return 'default';
}

function getDefaultPaneLayoutForProfile(profile) {
  const fromProfile = LAYOUT_DEFAULTS_BY_RESOURCE_PROFILE[profile] || LAYOUT_DEFAULTS_BY_RESOURCE_PROFILE.default;
  return normalizePaneLayout(fromProfile, DEFAULT_PANE_LAYOUT);
}

function resolvePaneLayout(typeUrn, overrideLayout) {
  if (overrideLayout) {
    return {
      profile: resolveResourceProfile(typeUrn),
      layout: normalizePaneLayout(overrideLayout, DEFAULT_PANE_LAYOUT),
      fromOverride: true,
    };
  }

  const profile = resolveResourceProfile(typeUrn);
  return {
    profile,
    layout: getDefaultPaneLayoutForProfile(profile),
    fromOverride: false,
  };
}

function getPaneElements(position) {
  return {
    panel: document.getElementById(`pane-${position}`),
    label: document.getElementById(`pane-label-${position}`),
    slot: document.getElementById(`pane-slot-${position}`),
  };
}

function getPanePositionForContent(layout, contentType) {
  for (const pos of PANE_POSITIONS) {
    if (layout[pos] === contentType) return pos;
  }
  return null;
}

function getPaneSlotForContent(layout, contentType) {
  const pos = getPanePositionForContent(layout, contentType);
  if (!pos) return null;
  const els = getPaneElements(pos);
  return els.slot;
}

function applyPaneLayout(layout) {
  const normalized = normalizePaneLayout(layout, DEFAULT_PANE_LAYOUT);
  currentPaneLayout = normalized;

  for (const pos of PANE_POSITIONS) {
    const paneEls = getPaneElements(pos);
    const contentType = normalized[pos];
    const label = (PANE_CONTENT_META[contentType] && PANE_CONTENT_META[contentType].label) || 'Pane';

    if (paneEls.panel) paneEls.panel.dataset.paneContent = contentType;
    if (paneEls.label) paneEls.label.textContent = label;
    if (paneEls.slot) {
      paneEls.slot.classList.toggle('is-map-slot', contentType === PANE_CONTENT_TYPES.MAP);
    }
  }
}

// ── Panel divider: persist col/row split ratios in URL ────────────────────────

const MIN_PANE_RATIO = 0.2;  // 20% minimum for any column/row
const MAX_PANE_RATIO = 0.8;  // 80% maximum
const DEFAULT_MAP_VIEW = Object.freeze({ lat: 40.7506, lng: 14.4890, zoom: 15 });
const MAP_VIEW_EPSILON = Object.freeze({ latLng: 0.000001, zoom: 0.01 });

let currentColSplit = 0.5;  // left column width ratio
let currentRowSplit = 0.5;  // top row height ratio
let pendingMapViewOverride = null; // { lat, lng, zoom } from URL hash

function parseHashState() {
  const rawHash = location.hash.slice(1);
  const [encodedId, queryStr] = rawHash.split('?');
  const id = encodedId ? decodeURIComponent(encodedId) : '';

  const params = new URLSearchParams(queryStr || '');
  const col = parseFloat(params.get('col-split'));
  const row = parseFloat(params.get('row-split'));
  const mapLat = parseFloat(params.get('map-lat'));
  const mapLng = parseFloat(params.get('map-lng'));
  const mapZoom = parseFloat(params.get('map-z'));
  const layoutOverride = parsePaneLayout(params.get('layout'));

  const hasValidMapView =
    !isNaN(mapLat) && mapLat >= -90 && mapLat <= 90 &&
    !isNaN(mapLng) && mapLng >= -180 && mapLng <= 180 &&
    !isNaN(mapZoom) && mapZoom >= 0;

  return {
    id,
    colSplit: !isNaN(col) && col > 0 && col < 1 ? col : null,
    rowSplit: !isNaN(row) && row > 0 && row < 1 ? row : null,
    mapView: hasValidMapView ? { lat: mapLat, lng: mapLng, zoom: mapZoom } : null,
    layoutOverride,
  };
}

function applyRatiosFromHashState(hashState) {
  if (hashState && hashState.colSplit !== null) currentColSplit = hashState.colSplit;
  if (hashState && hashState.rowSplit !== null) currentRowSplit = hashState.rowSplit;
}

function applyGridRatios() {
  const grid = document.getElementById('grid');
  const divider = document.getElementById('grid-divider');
  grid.style.gridTemplateColumns = `${currentColSplit}fr ${1 - currentColSplit}fr`;
  grid.style.gridTemplateRows = `${currentRowSplit}fr ${1 - currentRowSplit}fr`;
  divider.style.left = `${currentColSplit * 100}%`;
  divider.style.top = `${currentRowSplit * 100}%`;
}

function buildHash(id, layoutOverride = currentPaneLayoutOverride) {
  const shortId = extractShortId(normalizeId(id || DEFAULT_ID));
  const params = new URLSearchParams();
  const colSplitFixed = currentColSplit.toFixed(3);
  const rowSplitFixed = currentRowSplit.toFixed(3);
  if (colSplitFixed !== '0.500') params.set('col-split', colSplitFixed);
  if (rowSplitFixed !== '0.500') params.set('row-split', rowSplitFixed);

  if (leafletMap && !isMapAtDefaultView()) {
    const center = leafletMap.getCenter();
    const zoom = leafletMap.getZoom();
    params.set('map-lat', center.lat.toFixed(6));
    params.set('map-lng', center.lng.toFixed(6));
    params.set('map-z', zoom.toFixed(2));
  }

  if (layoutOverride) params.set('layout', encodePaneLayout(layoutOverride));
  const query = params.toString();
  return query ? `#${encodeURIComponent(shortId)}?${query}` : `#${encodeURIComponent(shortId)}`;
}

function updateUrlWithRatios() {
  const hashState = parseHashState();
  const currentId = hashState.id || DEFAULT_ID;
  const newHash = buildHash(currentId, hashState.layoutOverride || currentPaneLayoutOverride);
  window.history.replaceState(null, '', newHash);
}

function initDividerDrag() {
  const divider = document.getElementById('grid-divider');
  const grid = document.getElementById('grid');

  let isDragging = false;

  divider.addEventListener('mousedown', e => {
    isDragging = true;
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const rect = grid.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Enforce min/max constraints
    const newColSplit = Math.max(MIN_PANE_RATIO, Math.min(MAX_PANE_RATIO, x / rect.width));
    const newRowSplit = Math.max(MIN_PANE_RATIO, Math.min(MAX_PANE_RATIO, y / rect.height));

    currentColSplit = newColSplit;
    currentRowSplit = newRowSplit;
    applyGridRatios();
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      updateUrlWithRatios();
    }
  });
}

// ── Leaflet map (initialized in DOMContentLoaded) ─────────────────────────────

let leafletMap  = null;
let layerGroup  = null;
let mapContainerEl = null;
let layersByEntityUrn = new Map();   // URN → { layer, defaultStyle } for hover linkage
let spatialHoverCache = new Map();  // featureUrn → resolved layerUrn|null, cleared on navigation
let ancestorByEntityUrnCache = new Map();  // entityUrn → ancestorUrn|null
let ancestorOutlineLayerCache = new Map(); // ancestorUrn → Leaflet layer
let pendingAncestorByEntityUrn = new Map(); // entityUrn → Promise<ancestorUrn|null>
let pendingAncestorOutlineLayerByUrn = new Map(); // ancestorUrn → Promise<LeafletLayer|null>
let activeAncestorOutlineUrn = null;
let currentHoveredEntityUrn = null;
let isOptionKeyDown = false;
let isCtrlKeyDown = false;
let firstImageElByEntityUrn = new Map(); // spatial/entity URN -> first image tile element
let activeMapHoverImageEl = null;
let imageAssociationBuildToken = 0;
let attentionPulseTimeoutByUrn = new Map(); // URN -> active pulse timeout id
let mapFocusHintEl = null;
let mapFocusHintTimeoutId = null;
let hierarchyState = null;
let hierarchyPreviewLayer = null;
let hierarchyPreviewUrn = null;
let hierarchyPreviewRequestToken = 0;
let suppressMapToImageHighlight = false;
let imageHoverIntentTimeoutByEl = new WeakMap();
const imageModalState = {
  isOpen: false,
  imageUrl: '',
  imageUrn: '',
  contextUrn: '',
  imageCaption: '',
  lunaLandingUrl: '',
  iiifManifestUrl: '',
  iiifImageUrl: '',
  geometryInitialized: false,
  triggerEl: null,
  suppressFocusHighlightEl: null,
  overlayEl: null,
  dialogEl: null,
  headerEl: null,
  titleEl: null,
  mediaEl: null,
  imgEl: null,
  infoEl: null,
  infoBodyEl: null,
  closeBtnEl: null,
  prevBtnEl: null,
  nextBtnEl: null,
  filterToggleBtnEl: null,
  zoomInBtnEl: null,
  zoomOutBtnEl: null,
  zoomResetBtnEl: null,
  filterControlsEl: null,
  filterBrightnessEl: null,
  filterContrastEl: null,
  filterSaturationEl: null,
  filterGrayscaleEl: null,
  filterInvertEl: null,
  filterResetBtnEl: null,
  filtersVisible: false,
  activeDisplayImageUrl: '',
  resizeHandleEl: null,
  ignoreOpenClickUntil: 0,
  imageSequence: [],
  activeSequenceIndex: -1,
  sequenceVersion: 0,
  navHighlightUrn: '',
  navHighlightToken: 0,
  captionRequestToken: 0,
  captionByImageUrn: new Map(),
  lunaLandingByImageUrn: new Map(),
  iiifManifestByImageUrn: new Map(),
  iiifImageByImageUrn: new Map(),
  eventsBound: false,
};

const imageModalDragState = {
  isDragging: false,
  pointerId: null,
  startPointerX: 0,
  startPointerY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
  offsetX: 0,
  offsetY: 0,
  bounds: null,
  didDrag: false,
  ignoreOverlayClickUntil: 0,
  eventsBound: false,
};

const imageModalResizeState = {
  isResizing: false,
  pointerId: null,
  startPointerX: 0,
  startPointerY: 0,
  startWidth: 0,
  startHeight: 0,
  widthPx: null,
  heightPx: null,
  didResize: false,
  ignoreOverlayClickUntil: 0,
  eventsBound: false,
};

const imageModalZoomState = {
  scale: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  eventsBound: false,
};

const IMAGE_MODAL_FILTER_DEFAULTS = Object.freeze({
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
  invert: 0,
});

const imageModalFilterState = {
  brightness: IMAGE_MODAL_FILTER_DEFAULTS.brightness,
  contrast: IMAGE_MODAL_FILTER_DEFAULTS.contrast,
  saturation: IMAGE_MODAL_FILTER_DEFAULTS.saturation,
  grayscale: IMAGE_MODAL_FILTER_DEFAULTS.grayscale,
  invert: IMAGE_MODAL_FILTER_DEFAULTS.invert,
  eventsBound: false,
};

const IMAGE_MODAL_INITIAL_GEOMETRY = Object.freeze({
  widthPx: 760,
  heightPx: 560,
  offsetX: -90,
  offsetY: 0,
});

const IMAGE_MODAL_ZOOM_MIN = 1;
const IMAGE_MODAL_ZOOM_MAX = 6;
const IMAGE_MODAL_ZOOM_STEP = 1.2;

const HIGHLIGHT_STYLE = Object.freeze({
  color: '#ff9900',
  weight: 4,
  fillColor: '#ffcc00',
  fillOpacity: 0.5,
});

const HIERARCHY_PREVIEW_STYLE = Object.freeze({
  color: '#ff9900',
  weight: 5,
  fillColor: '#ffcc00',
  fillOpacity: 0.16,
  opacity: 1,
});

const ANCESTOR_OUTLINE_STYLE = Object.freeze({
  color: '#005a9c',
  weight: 3,
  opacity: 1,
  fillOpacity: 0,
  dashArray: '',
});

const IMAGE_HOVER_CLASS = 'is-highlighted';

function syncHighlightCssVars() {
  document.documentElement.style.setProperty('--map-highlight-border', HIGHLIGHT_STYLE.color);
  document.documentElement.style.setProperty('--map-highlight-fill', HIGHLIGHT_STYLE.fillColor);
}

function setImageHoverState(el, isActive) {
  if (!el) return;
  el.classList.toggle(IMAGE_HOVER_CLASS, isActive);
}

function beginImageTileHighlight(el) {
  if (!el) return;
  setImageHoverState(el, true);
}

function endImageTileHighlight(el) {
  if (!el) return;
  setImageHoverState(el, false);
  if (activeMapHoverImageEl === el) activeMapHoverImageEl = null;
}

function shouldSuppressImageFocusHighlight(el) {
  if (!el) return false;
  if (imageModalState.suppressFocusHighlightEl !== el) return false;
  imageModalState.suppressFocusHighlightEl = null;
  endImageTileHighlight(el);
  return true;
}

function clearActiveMapHoverImage() {
  if (!activeMapHoverImageEl) return;
  setImageHoverState(activeMapHoverImageEl, false);
  activeMapHoverImageEl = null;
}

function cancelImageHoverIntent(el) {
  if (!el) return;
  const timeoutId = imageHoverIntentTimeoutByEl.get(el);
  if (!timeoutId) return;
  clearTimeout(timeoutId);
  imageHoverIntentTimeoutByEl.delete(el);
}

function scheduleImageHoverIntent(el, callback) {
  if (!el || typeof callback !== 'function') return;
  cancelImageHoverIntent(el);

  const timeoutId = setTimeout(() => {
    if (imageHoverIntentTimeoutByEl.get(el) !== timeoutId) return;
    imageHoverIntentTimeoutByEl.delete(el);
    callback();
  }, IMAGE_HOVER_INTENT_DELAY_MS);

  imageHoverIntentTimeoutByEl.set(el, timeoutId);
}

function clearImageAssociations() {
  imageAssociationBuildToken += 1;
  firstImageElByEntityUrn.clear();
  clearActiveMapHoverImage();
  invalidateImageModalSequence();
}

function normalizeImageModalPayload(payload = {}, { requireImageUrl = true } = {}) {
  const imageUrl = String(payload.imageUrl || '').trim();
  if (requireImageUrl && !imageUrl) return null;

  const triggerEl = payload.triggerEl && document.contains(payload.triggerEl)
    ? payload.triggerEl
    : null;

  return {
    imageUrl,
    imageUrn: String(payload.imageUrn || '').trim(),
    contextUrn: String(payload.contextUrn || '').trim(),
    imageCaption: normalizeImageModalCaption(payload.imageCaption || ''),
    iiifManifestUrl: String(payload.iiifManifestUrl || '').trim(),
    iiifImageUrl: String(payload.iiifImageUrl || '').trim(),
    triggerEl,
  };
}

function normalizeImageModalCaption(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  return text;
}

function formatImageModalCaptionHtml(caption) {
  return escHtml(caption).replace(/\n/g, '<br>');
}

function renderImageModalUrnValue(urn) {
  const short = extractShortId(urn);
  return '<span class="image-modal-urn-short">' + escHtml(short) + '</span>' +
    '<button type="button" class="image-modal-urn-action" data-image-modal-navigate="' + escAttr(urn) + '" aria-label="Open ' + escAttr(short) + '" title="Open ' + escAttr(short) + '">↗</button>';
}

function getLunaTildeVal(imageUrn) {
  if (imageUrn.startsWith('urn:p-lod:id:luna_img_PALP')) return '14';
  if (imageUrn.startsWith('urn:p-lod:id:luna_img_PPM'))  return '16';
  return null;
}

function buildLunaLandingUrl(imageUrn, lRecord, lMedia) {
  const tilde = getLunaTildeVal(imageUrn);
  if (!tilde || !lRecord || !lMedia) return '';
  return `${LUNA_BASE_URL}/luna/servlet/detail/umass~${tilde}~${tilde}~${lRecord}~${lMedia}`;
}

function buildLunaIiifIdentity(imageUrn, lRecord, lMedia) {
  const tilde = getLunaTildeVal(imageUrn);
  if (!tilde || !lRecord || !lMedia) return '';
  return `umass~${tilde}~${tilde}~${lRecord}~${lMedia}`;
}

function buildLunaIiifManifestUrl(lunaIdentity) {
  if (!lunaIdentity) return '';
  return `${LUNA_BASE_URL}/luna/servlet/iiif/m/${lunaIdentity}/manifest`;
}

function extractIiifImageUrlFromManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return '';

  const tryGet = obj => {
    if (!obj || typeof obj !== 'object') return '';
    return String(obj.id || obj['@id'] || '').trim();
  };

  const seq = Array.isArray(manifest.sequences) ? manifest.sequences[0] : null;
  const canvas = seq && Array.isArray(seq.canvases) ? seq.canvases[0] : null;
  const imageAnno = canvas && Array.isArray(canvas.images) ? canvas.images[0] : null;
  const resource = imageAnno && imageAnno.resource ? imageAnno.resource : null;
  const iiif2Direct = tryGet(resource);
  if (iiif2Direct) return iiif2Direct;

  const items = Array.isArray(manifest.items) ? manifest.items : null;
  const canvas3 = items ? items[0] : null;
  const annoPage = canvas3 && Array.isArray(canvas3.items) ? canvas3.items[0] : null;
  const anno = annoPage && Array.isArray(annoPage.items) ? annoPage.items[0] : null;
  const body = anno && anno.body ? anno.body : null;
  const iiif3Direct = tryGet(body);
  if (iiif3Direct) return iiif3Direct;

  const service = (body && (body.service || (Array.isArray(body.service) ? body.service[0] : null)))
    || (resource && (resource.service || (Array.isArray(resource.service) ? resource.service[0] : null)));
  const serviceId = tryGet(service);
  if (!serviceId) return '';
  return `${serviceId.replace(/\/$/, '')}/full/1200,/0/default.jpg`;
}

async function fetchIiifImageUrlFromManifest(iiifManifestUrl) {
  if (!iiifManifestUrl) return '';

  try {
    const r = await fetch(iiifManifestUrl);
    if (!r.ok) return '';
    const manifest = await r.json();
    return extractIiifImageUrlFromManifest(manifest);
  } catch (_) {
    return '';
  }
}

async function fetchImageIdData(imageUrn) {
  if (!imageUrn) return { caption: '', lunaLandingUrl: '', iiifManifestUrl: '', iiifImageUrl: '' };

  try {
    const shortId = extractShortId(imageUrn);
    const r = await fetch(`${API_BASE}/id/${encodeURIComponent(shortId)}`);
    if (!r.ok) return { caption: '', lunaLandingUrl: '', iiifManifestUrl: '', iiifImageUrl: '' };
    const triples = flattenTriples(await r.json());
    const caption = normalizeImageModalCaption((triples[IMAGE_MODAL_CAPTION_PREDICATE] || [])[0] || '');
    const lRecord = (triples[LUNA_RECORD_ID_PREDICATE] || [])[0] || '';
    const lMedia  = (triples[LUNA_MEDIA_ID_PREDICATE]  || [])[0] || '';
    const lunaIdentity = buildLunaIiifIdentity(imageUrn, lRecord, lMedia);
    const iiifManifestUrl = buildLunaIiifManifestUrl(lunaIdentity);
    const iiifImageUrl = await fetchIiifImageUrlFromManifest(iiifManifestUrl);
    return {
      caption,
      lunaLandingUrl: buildLunaLandingUrl(imageUrn, lRecord, lMedia),
      iiifManifestUrl,
      iiifImageUrl,
    };
  } catch (_) {
    return { caption: '', lunaLandingUrl: '', iiifManifestUrl: '', iiifImageUrl: '' };
  }
}

function requestImageModalCaptionIfMissing() {
  const imageUrn = imageModalState.imageUrn;
  if (!imageUrn || (imageModalState.imageCaption && imageModalState.lunaLandingUrl && imageModalState.iiifManifestUrl)) return;

  if (imageModalState.captionByImageUrn.has(imageUrn)) {
    const cachedCaption = imageModalState.captionByImageUrn.get(imageUrn) || '';
    const cachedLuna   = imageModalState.lunaLandingByImageUrn.get(imageUrn) || '';
    const cachedIiifManifest = imageModalState.iiifManifestByImageUrn.get(imageUrn) || '';
    const cachedIiifImage = imageModalState.iiifImageByImageUrn.get(imageUrn) || '';
    let changed = false;
    if (cachedCaption && imageModalState.imageUrn === imageUrn && !imageModalState.imageCaption) {
      imageModalState.imageCaption = cachedCaption;
      changed = true;
    }
    if (cachedLuna && imageModalState.imageUrn === imageUrn && !imageModalState.lunaLandingUrl) {
      imageModalState.lunaLandingUrl = cachedLuna;
      changed = true;
    }
    if (cachedIiifManifest && imageModalState.imageUrn === imageUrn && !imageModalState.iiifManifestUrl) {
      imageModalState.iiifManifestUrl = cachedIiifManifest;
      changed = true;
    }
    if (cachedIiifImage && imageModalState.imageUrn === imageUrn && !imageModalState.iiifImageUrl) {
      imageModalState.iiifImageUrl = cachedIiifImage;
      changed = true;
    }
    if (changed) renderImageModalContent();
    return;
  }

  const token = ++imageModalState.captionRequestToken;
  void fetchImageIdData(imageUrn).then(({ caption, lunaLandingUrl, iiifManifestUrl, iiifImageUrl }) => {
    imageModalState.captionByImageUrn.set(imageUrn, caption || '');
    imageModalState.lunaLandingByImageUrn.set(imageUrn, lunaLandingUrl || '');
    imageModalState.iiifManifestByImageUrn.set(imageUrn, iiifManifestUrl || '');
    imageModalState.iiifImageByImageUrn.set(imageUrn, iiifImageUrl || '');
    if (token !== imageModalState.captionRequestToken) return;
    if (!imageModalState.isOpen) return;
    if (imageModalState.imageUrn !== imageUrn) return;

    let changed = false;
    if (caption && !imageModalState.imageCaption) {
      imageModalState.imageCaption = caption;
      changed = true;
    }
    if (lunaLandingUrl && !imageModalState.lunaLandingUrl) {
      imageModalState.lunaLandingUrl = lunaLandingUrl;
      changed = true;
    }
    if (iiifManifestUrl && !imageModalState.iiifManifestUrl) {
      imageModalState.iiifManifestUrl = iiifManifestUrl;
      changed = true;
    }
    if (iiifImageUrl && !imageModalState.iiifImageUrl) {
      imageModalState.iiifImageUrl = iiifImageUrl;
      changed = true;
    }
    if (changed) renderImageModalContent();
  });
}

function getImageModalTileFromElement(el) {
  if (!el || !document.contains(el)) return null;
  return el.closest('[data-image-url], .image-urn-fallback');
}

function collectImageModalSequence() {
  const imageSlot = getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.IMAGES);
  if (!imageSlot) return [];

  return Array.from(
    imageSlot.querySelectorAll('.image-grid [data-image-url], .image-grid .image-urn-fallback')
  ).filter(el => document.contains(el));
}

function getImageModalPayloadFromSequenceTile(tileEl) {
  if (!tileEl || !document.contains(tileEl)) return null;

  return normalizeImageModalPayload({
    imageUrl: tileEl.dataset.imageUrl || '',
    imageUrn: tileEl.dataset.imageUrn || tileEl.dataset.entityUrn || '',
    contextUrn: tileEl.dataset.featureUrn || tileEl.dataset.entityUrn || '',
    imageCaption: tileEl.dataset.imageCaption || '',
    triggerEl: tileEl,
  }, { requireImageUrl: false });
}

function resolveImageModalSequenceIndex(sequence, payload) {
  if (!Array.isArray(sequence) || !sequence.length || !payload) return -1;

  const triggerTile = getImageModalTileFromElement(payload.triggerEl);
  if (triggerTile) {
    const triggerIdx = sequence.indexOf(triggerTile);
    if (triggerIdx >= 0) return triggerIdx;
  }

  if (payload.imageUrn) {
    const byUrn = sequence.findIndex(el => String(el.dataset.imageUrn || el.dataset.entityUrn || '') === payload.imageUrn);
    if (byUrn >= 0) return byUrn;
  }

  if (payload.imageUrl) {
    const byUrl = sequence.findIndex(el => String(el.dataset.imageUrl || '') === payload.imageUrl);
    if (byUrl >= 0) return byUrl;
  }

  return -1;
}

function updateImageModalNavControls() {
  const hasSequence = imageModalState.imageSequence.length > 1;

  if (imageModalState.prevBtnEl) {
    imageModalState.prevBtnEl.disabled = !hasSequence;
    imageModalState.prevBtnEl.setAttribute('aria-disabled', hasSequence ? 'false' : 'true');
  }

  if (imageModalState.nextBtnEl) {
    imageModalState.nextBtnEl.disabled = !hasSequence;
    imageModalState.nextBtnEl.setAttribute('aria-disabled', hasSequence ? 'false' : 'true');
  }
}

function invalidateImageModalSequence() {
  imageModalState.sequenceVersion += 1;
  imageModalState.imageSequence = [];
  imageModalState.activeSequenceIndex = -1;
  updateImageModalNavControls();
}

function rebuildImageModalSequence(activePayload = null) {
  imageModalState.sequenceVersion += 1;
  imageModalState.imageSequence = collectImageModalSequence();
  imageModalState.activeSequenceIndex = resolveImageModalSequenceIndex(imageModalState.imageSequence, activePayload);
  updateImageModalNavControls();
}

function syncImageModalSequenceToPayload(payload) {
  if (!payload) return;

  if (!imageModalState.imageSequence.length) {
    rebuildImageModalSequence(payload);
    return;
  }

  const idx = resolveImageModalSequenceIndex(imageModalState.imageSequence, payload);
  if (idx >= 0) imageModalState.activeSequenceIndex = idx;
  updateImageModalNavControls();
}

function normalizeImageModalSequenceIndex(rawIndex, len) {
  if (!len) return -1;
  return ((rawIndex % len) + len) % len;
}

function syncImageModalSequenceTileHighlight(tileEl) {
  if (!tileEl || !document.contains(tileEl)) return;

  clearActiveMapHoverImage();
  beginImageTileHighlight(tileEl);
  activeMapHoverImageEl = tileEl;
  tileEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function clearImageModalNavigationMapHighlight() {
  imageModalState.navHighlightToken += 1;

  if (!imageModalState.navHighlightUrn) return;
  paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: imageModalState.navHighlightUrn, source: 'image' });
  imageModalState.navHighlightUrn = '';
}

function emitImageModalNavigationHighlightForTile(tileEl) {
  if (!tileEl) {
    clearImageModalNavigationMapHighlight();
    return;
  }

  const token = ++imageModalState.navHighlightToken;

  const setHighlightUrn = urn => {
    if (token !== imageModalState.navHighlightToken) return;

    if (imageModalState.navHighlightUrn && imageModalState.navHighlightUrn !== urn) {
      paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: imageModalState.navHighlightUrn, source: 'image' });
    }

    imageModalState.navHighlightUrn = urn || '';
    if (urn) paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn, shouldPan: true, source: 'image' });
  };

  const entityUrn = String(tileEl.dataset.entityUrn || '');
  if (entityUrn) {
    setHighlightUrn(entityUrn);
    return;
  }

  const featureUrn = String(tileEl.dataset.featureUrn || '');
  if (!featureUrn) {
    setHighlightUrn('');
    return;
  }

  void resolveFeatureToLayer(featureUrn).then(layerUrn => {
    setHighlightUrn(layerUrn || '');
  });
}

function stepImageModalSequence(direction) {
  if (!canSyncOpenImageModal()) return false;

  if (!imageModalState.imageSequence.length) {
    rebuildImageModalSequence(imageModalState);
  }

  const sequence = imageModalState.imageSequence;
  const len = sequence.length;
  if (!len) return false;

  const startIndex = imageModalState.activeSequenceIndex >= 0
    ? imageModalState.activeSequenceIndex
    : 0;
  const nextIndex = normalizeImageModalSequenceIndex(startIndex + direction, len);
  const nextTile = sequence[nextIndex];
  if (!nextTile || !document.contains(nextTile)) {
    rebuildImageModalSequence(imageModalState);
    return false;
  }

  const payload = getImageModalPayloadFromSequenceTile(nextTile);
  if (!payload) return false;

  syncOpenImageModal(payload, { requireImageUrl: false, updateTriggerEl: true });
  imageModalState.activeSequenceIndex = nextIndex;
  updateImageModalNavControls();
  syncImageModalSequenceTileHighlight(nextTile);
  emitImageModalNavigationHighlightForTile(nextTile);
  return true;
}

function hasSameImageModalPayload(payload) {
  return !!payload
    && imageModalState.imageUrl === payload.imageUrl
    && imageModalState.imageUrn === payload.imageUrn
    && imageModalState.contextUrn === payload.contextUrn
    && imageModalState.imageCaption === payload.imageCaption
    && imageModalState.lunaLandingUrl === (payload.lunaLandingUrl || '')
    && imageModalState.iiifManifestUrl === (payload.iiifManifestUrl || '')
    && imageModalState.iiifImageUrl === (payload.iiifImageUrl || '');
}

function applyImageModalPayload(payload, { updateTriggerEl = false } = {}) {
  imageModalState.captionRequestToken += 1;
  imageModalState.imageUrl = payload.imageUrl;
  imageModalState.imageUrn = payload.imageUrn;
  imageModalState.contextUrn = payload.contextUrn;
  imageModalState.imageCaption = payload.imageCaption || '';
  imageModalState.lunaLandingUrl = payload.lunaLandingUrl || '';
  imageModalState.iiifManifestUrl = payload.iiifManifestUrl || '';
  imageModalState.iiifImageUrl = payload.iiifImageUrl || '';
  if (updateTriggerEl) imageModalState.triggerEl = payload.triggerEl || null;
}

function canSyncOpenImageModal() {
  return imageModalState.isOpen
    && !imageModalDragState.isDragging
    && !imageModalResizeState.isResizing;
}

function getImageModalPayloadFromElement(el, contextUrn = '') {
  if (!el || !document.contains(el)) return null;
  const imageUrl = String(el.dataset.imageUrl || '').trim();
  if (!imageUrl) return null;

  return normalizeImageModalPayload({
    imageUrl,
    imageUrn: el.dataset.imageUrn || el.dataset.entityUrn || '',
    contextUrn: contextUrn || el.dataset.featureUrn || el.dataset.entityUrn || '',
    imageCaption: el.dataset.imageCaption || '',
    triggerEl: el,
  });
}

function syncOpenImageModal(payload = {}, { requireImageUrl = true, updateTriggerEl = false } = {}) {
  if (!canSyncOpenImageModal()) return false;

  const normalized = normalizeImageModalPayload(payload, { requireImageUrl });
  if (!normalized) return false;

  if (hasSameImageModalPayload(normalized)) {
    if (updateTriggerEl) imageModalState.triggerEl = normalized.triggerEl || imageModalState.triggerEl;
    syncImageModalSequenceToPayload(normalized);
    return false;
  }

  applyImageModalPayload(normalized, { updateTriggerEl });
  renderImageModalContent();
  syncImageModalSequenceToPayload(normalized);
  return true;
}

function syncOpenImageModalFromElement(el, contextUrn = '') {
  const payload = getImageModalPayloadFromElement(el, contextUrn);
  if (!payload) return false;
  return syncOpenImageModal(payload);
}

function syncOpenImageModalFromEntityUrn(entityUrn) {
  if (!entityUrn) return false;
  const imageEl = firstImageElByEntityUrn.get(entityUrn);
  if (!imageEl) return false;
  return syncOpenImageModalFromElement(imageEl, entityUrn);
}

function applyImageModalDragTransform() {
  if (!imageModalState.dialogEl) return;

  const x = imageModalDragState.offsetX;
  const y = imageModalDragState.offsetY;
  if (!x && !y) {
    imageModalState.dialogEl.style.transform = '';
    return;
  }

  imageModalState.dialogEl.style.transform = `translate(${x}px, ${y}px)`;
}

function getImageModalSizeLimits() {
  const edge = 8;
  const maxWidth = Math.max(180, window.innerWidth - (edge * 2));
  const maxHeight = Math.max(140, window.innerHeight - (edge * 2));
  const minWidth = Math.min(360, maxWidth);
  const minHeight = Math.min(220, maxHeight);

  return {
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
  };
}

function applyImageModalResizeStyles() {
  if (!imageModalState.dialogEl) return;

  if (typeof imageModalResizeState.widthPx === 'number') {
    imageModalState.dialogEl.style.width = `${imageModalResizeState.widthPx}px`;
  } else {
    imageModalState.dialogEl.style.removeProperty('width');
  }

  if (typeof imageModalResizeState.heightPx === 'number') {
    imageModalState.dialogEl.style.height = `${imageModalResizeState.heightPx}px`;
  } else {
    imageModalState.dialogEl.style.removeProperty('height');
  }
}

function clampImageModalSizeToViewport() {
  const limits = getImageModalSizeLimits();

  if (typeof imageModalResizeState.widthPx === 'number') {
    imageModalResizeState.widthPx = Math.min(
      limits.maxWidth,
      Math.max(limits.minWidth, imageModalResizeState.widthPx)
    );
  }

  if (typeof imageModalResizeState.heightPx === 'number') {
    imageModalResizeState.heightPx = Math.min(
      limits.maxHeight,
      Math.max(limits.minHeight, imageModalResizeState.heightPx)
    );
  }
}

function syncImageModalGeometryToViewport() {
  if (!imageModalState.dialogEl) return;

  clampImageModalSizeToViewport();
  applyImageModalResizeStyles();

  imageModalDragState.bounds = computeImageModalDragBounds();
  const clamped = clampImageModalOffset(imageModalDragState.offsetX, imageModalDragState.offsetY);
  imageModalDragState.offsetX = clamped.x;
  imageModalDragState.offsetY = clamped.y;
  applyImageModalDragTransform();
}

function ensureImageModalInitialGeometry() {
  if (imageModalState.geometryInitialized) return;

  imageModalResizeState.widthPx = IMAGE_MODAL_INITIAL_GEOMETRY.widthPx;
  imageModalResizeState.heightPx = IMAGE_MODAL_INITIAL_GEOMETRY.heightPx;
  imageModalDragState.offsetX = IMAGE_MODAL_INITIAL_GEOMETRY.offsetX;
  imageModalDragState.offsetY = IMAGE_MODAL_INITIAL_GEOMETRY.offsetY;

  imageModalState.geometryInitialized = true;
}

function resetImageModalDragPosition() {
  imageModalDragState.offsetX = 0;
  imageModalDragState.offsetY = 0;
  applyImageModalDragTransform();
}

function computeImageModalDragBounds() {
  if (!imageModalState.dialogEl) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  const rect = imageModalState.dialogEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const edge = 8;

  // Bounds are expressed in absolute offset-space (translateX/translateY),
  // so we must first recover the un-translated base rectangle.
  const baseLeft = rect.left - imageModalDragState.offsetX;
  const baseRight = rect.right - imageModalDragState.offsetX;
  const baseTop = rect.top - imageModalDragState.offsetY;
  const baseBottom = rect.bottom - imageModalDragState.offsetY;

  return {
    minX: edge - baseLeft,
    maxX: (viewportWidth - edge) - baseRight,
    minY: edge - baseTop,
    maxY: (viewportHeight - edge) - baseBottom,
  };
}

function clampImageModalOffset(x, y) {
  const bounds = imageModalDragState.bounds || computeImageModalDragBounds();
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
  };
}

function endImageModalDrag(pointerId = null, markIgnoreOverlayClick = true) {
  if (!imageModalDragState.isDragging) return;
  if (pointerId !== null && imageModalDragState.pointerId !== pointerId) return;

  const hadDragged = imageModalDragState.didDrag;
  const activePointerId = imageModalDragState.pointerId;

  imageModalDragState.isDragging = false;
  imageModalDragState.pointerId = null;
  imageModalDragState.bounds = null;
  imageModalDragState.didDrag = false;

  if (imageModalState.overlayEl) imageModalState.overlayEl.classList.remove('is-dragging');
  if (imageModalState.headerEl && activePointerId !== null && imageModalState.headerEl.releasePointerCapture) {
    try {
      imageModalState.headerEl.releasePointerCapture(activePointerId);
    } catch (_) {
      // Ignore capture release failures from stale pointers.
    }
  }

  window.removeEventListener('pointermove', onImageModalDragPointerMove);
  window.removeEventListener('pointerup', onImageModalDragPointerUp);
  window.removeEventListener('pointercancel', onImageModalDragPointerCancel);

  if (markIgnoreOverlayClick && hadDragged) {
    imageModalDragState.ignoreOverlayClickUntil = Date.now() + 180;
  }
}

function onImageModalDragPointerMove(e) {
  if (!imageModalDragState.isDragging) return;
  if (e.pointerId !== imageModalDragState.pointerId) return;

  e.preventDefault();

  const dx = e.clientX - imageModalDragState.startPointerX;
  const dy = e.clientY - imageModalDragState.startPointerY;
  const proposedX = imageModalDragState.startOffsetX + dx;
  const proposedY = imageModalDragState.startOffsetY + dy;
  const clamped = clampImageModalOffset(proposedX, proposedY);

  imageModalDragState.offsetX = clamped.x;
  imageModalDragState.offsetY = clamped.y;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) imageModalDragState.didDrag = true;
  applyImageModalDragTransform();
}

function onImageModalDragPointerUp(e) {
  endImageModalDrag(e.pointerId, true);
}

function onImageModalDragPointerCancel(e) {
  endImageModalDrag(e.pointerId, true);
}

function onImageModalDragPointerDown(e) {
  if (!imageModalState.isOpen || !imageModalState.dialogEl) return;
  if (e.button !== 0) return;
  if (imageModalResizeState.isResizing) return;
  if (e.target && e.target.closest('[data-image-modal-close]')) return;
  if (e.target && e.target.closest('[data-image-modal-resize-handle]')) return;

  e.preventDefault();
  e.stopPropagation();

  imageModalDragState.isDragging = true;
  imageModalDragState.pointerId = e.pointerId;
  imageModalDragState.startPointerX = e.clientX;
  imageModalDragState.startPointerY = e.clientY;
  imageModalDragState.startOffsetX = imageModalDragState.offsetX;
  imageModalDragState.startOffsetY = imageModalDragState.offsetY;
  imageModalDragState.bounds = computeImageModalDragBounds();
  imageModalDragState.didDrag = false;

  if (imageModalState.overlayEl) imageModalState.overlayEl.classList.add('is-dragging');
  if (imageModalState.headerEl && imageModalState.headerEl.setPointerCapture) {
    try {
      imageModalState.headerEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // Ignore capture errors; drag still works via window listeners.
    }
  }

  window.addEventListener('pointermove', onImageModalDragPointerMove);
  window.addEventListener('pointerup', onImageModalDragPointerUp);
  window.addEventListener('pointercancel', onImageModalDragPointerCancel);
}

function bindImageModalDragEvents() {
  ensureImageModalInitialized();
  if (imageModalDragState.eventsBound || !imageModalState.headerEl) return;

  imageModalDragState.eventsBound = true;
  imageModalState.headerEl.addEventListener('pointerdown', onImageModalDragPointerDown);

  window.addEventListener('resize', () => {
    if (!imageModalState.isOpen || imageModalDragState.isDragging || imageModalResizeState.isResizing) return;
    syncImageModalGeometryToViewport();
    applyImageModalImageTransform();
  });
}

function endImageModalResize(pointerId = null, markIgnoreOverlayClick = true) {
  if (!imageModalResizeState.isResizing) return;
  if (pointerId !== null && imageModalResizeState.pointerId !== pointerId) return;

  const hadResized = imageModalResizeState.didResize;
  const activePointerId = imageModalResizeState.pointerId;

  imageModalResizeState.isResizing = false;
  imageModalResizeState.pointerId = null;
  imageModalResizeState.didResize = false;

  if (imageModalState.overlayEl) imageModalState.overlayEl.classList.remove('is-resizing');
  if (imageModalState.resizeHandleEl && activePointerId !== null && imageModalState.resizeHandleEl.releasePointerCapture) {
    try {
      imageModalState.resizeHandleEl.releasePointerCapture(activePointerId);
    } catch (_) {
      // Ignore capture release failures from stale pointers.
    }
  }

  window.removeEventListener('pointermove', onImageModalResizePointerMove);
  window.removeEventListener('pointerup', onImageModalResizePointerUp);
  window.removeEventListener('pointercancel', onImageModalResizePointerCancel);

  if (markIgnoreOverlayClick && hadResized) {
    imageModalResizeState.ignoreOverlayClickUntil = Date.now() + 180;
  }
}

function onImageModalResizePointerMove(e) {
  if (!imageModalResizeState.isResizing) return;
  if (e.pointerId !== imageModalResizeState.pointerId) return;

  e.preventDefault();

  const dx = e.clientX - imageModalResizeState.startPointerX;
  const dy = e.clientY - imageModalResizeState.startPointerY;

  const limits = getImageModalSizeLimits();
  imageModalResizeState.widthPx = Math.min(
    limits.maxWidth,
    Math.max(limits.minWidth, imageModalResizeState.startWidth + dx)
  );
  imageModalResizeState.heightPx = Math.min(
    limits.maxHeight,
    Math.max(limits.minHeight, imageModalResizeState.startHeight + dy)
  );

  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) imageModalResizeState.didResize = true;
  syncImageModalGeometryToViewport();
}

function onImageModalResizePointerUp(e) {
  endImageModalResize(e.pointerId, true);
}

function onImageModalResizePointerCancel(e) {
  endImageModalResize(e.pointerId, true);
}

function onImageModalResizePointerDown(e) {
  if (!imageModalState.isOpen || !imageModalState.dialogEl) return;
  if (e.button !== 0) return;
  if (imageModalDragState.isDragging) return;

  e.preventDefault();
  e.stopPropagation();

  const rect = imageModalState.dialogEl.getBoundingClientRect();

  imageModalResizeState.isResizing = true;
  imageModalResizeState.pointerId = e.pointerId;
  imageModalResizeState.startPointerX = e.clientX;
  imageModalResizeState.startPointerY = e.clientY;
  imageModalResizeState.startWidth = rect.width;
  imageModalResizeState.startHeight = rect.height;
  imageModalResizeState.didResize = false;

  if (imageModalState.overlayEl) imageModalState.overlayEl.classList.add('is-resizing');
  if (imageModalState.resizeHandleEl && imageModalState.resizeHandleEl.setPointerCapture) {
    try {
      imageModalState.resizeHandleEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // Ignore capture errors; resize still works via window listeners.
    }
  }

  window.addEventListener('pointermove', onImageModalResizePointerMove);
  window.addEventListener('pointerup', onImageModalResizePointerUp);
  window.addEventListener('pointercancel', onImageModalResizePointerCancel);
}

function bindImageModalResizeEvents() {
  ensureImageModalInitialized();
  if (imageModalResizeState.eventsBound || !imageModalState.resizeHandleEl) return;

  imageModalResizeState.eventsBound = true;
  imageModalState.resizeHandleEl.addEventListener('pointerdown', onImageModalResizePointerDown);
}

function clampImageModalPan() {
  if (!imageModalState.imgEl || !imageModalState.mediaEl) return;
  if (imageModalZoomState.scale <= IMAGE_MODAL_ZOOM_MIN) {
    imageModalZoomState.panX = 0;
    imageModalZoomState.panY = 0;
    return;
  }

  const viewportW = imageModalState.mediaEl.clientWidth;
  const viewportH = imageModalState.mediaEl.clientHeight;
  const baseW = imageModalState.imgEl.offsetWidth;
  const baseH = imageModalState.imgEl.offsetHeight;
  if (!viewportW || !viewportH || !baseW || !baseH) {
    imageModalZoomState.panX = 0;
    imageModalZoomState.panY = 0;
    return;
  }

  const scaledW = baseW * imageModalZoomState.scale;
  const scaledH = baseH * imageModalZoomState.scale;
  const maxPanX = Math.max(0, (scaledW - viewportW) / 2);
  const maxPanY = Math.max(0, (scaledH - viewportH) / 2);

  imageModalZoomState.panX = Math.max(-maxPanX, Math.min(maxPanX, imageModalZoomState.panX));
  imageModalZoomState.panY = Math.max(-maxPanY, Math.min(maxPanY, imageModalZoomState.panY));
}

function updateImageModalZoomControls() {
  const canZoomIn = imageModalZoomState.scale < IMAGE_MODAL_ZOOM_MAX - 0.001;
  const canZoomOut = imageModalZoomState.scale > IMAGE_MODAL_ZOOM_MIN + 0.001;

  if (imageModalState.zoomInBtnEl) imageModalState.zoomInBtnEl.disabled = !canZoomIn;
  if (imageModalState.zoomOutBtnEl) imageModalState.zoomOutBtnEl.disabled = !canZoomOut;
  if (imageModalState.zoomResetBtnEl) imageModalState.zoomResetBtnEl.disabled = !canZoomOut;
}

function applyImageModalImageTransform() {
  if (!imageModalState.imgEl || !imageModalState.mediaEl) return;

  clampImageModalPan();

  const scale = imageModalZoomState.scale;
  const tx = imageModalZoomState.panX;
  const ty = imageModalZoomState.panY;
  imageModalState.imgEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  imageModalState.mediaEl.classList.toggle('is-zoomed', scale > IMAGE_MODAL_ZOOM_MIN + 0.001);

  updateImageModalZoomControls();
}

function resetImageModalZoom() {
  imageModalZoomState.scale = IMAGE_MODAL_ZOOM_MIN;
  imageModalZoomState.panX = 0;
  imageModalZoomState.panY = 0;
  applyImageModalImageTransform();
}

function setImageModalZoom(nextScale) {
  const clamped = Math.max(IMAGE_MODAL_ZOOM_MIN, Math.min(IMAGE_MODAL_ZOOM_MAX, nextScale));
  imageModalZoomState.scale = clamped;
  if (clamped <= IMAGE_MODAL_ZOOM_MIN + 0.001) {
    imageModalZoomState.panX = 0;
    imageModalZoomState.panY = 0;
  }
  applyImageModalImageTransform();
}

function zoomImageModalBy(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return;
  setImageModalZoom(imageModalZoomState.scale * factor);
}

function endImageModalPan(pointerId = null) {
  if (!imageModalZoomState.isPanning) return;
  if (pointerId !== null && imageModalZoomState.pointerId !== pointerId) return;

  const activePointerId = imageModalZoomState.pointerId;
  imageModalZoomState.isPanning = false;
  imageModalZoomState.pointerId = null;

  if (imageModalState.mediaEl && activePointerId !== null && imageModalState.mediaEl.releasePointerCapture) {
    try {
      imageModalState.mediaEl.releasePointerCapture(activePointerId);
    } catch (_) {
      // Ignore capture release errors.
    }
  }
}

function onImageModalPanPointerMove(e) {
  if (!imageModalZoomState.isPanning) return;
  if (e.pointerId !== imageModalZoomState.pointerId) return;

  e.preventDefault();

  const dx = e.clientX - imageModalZoomState.startX;
  const dy = e.clientY - imageModalZoomState.startY;
  imageModalZoomState.panX = imageModalZoomState.startPanX + dx;
  imageModalZoomState.panY = imageModalZoomState.startPanY + dy;
  applyImageModalImageTransform();
}

function onImageModalPanPointerUp(e) {
  endImageModalPan(e.pointerId);
}

function onImageModalPanPointerCancel(e) {
  endImageModalPan(e.pointerId);
}

function onImageModalPanPointerDown(e) {
  if (!imageModalState.isOpen || !imageModalState.mediaEl) return;
  if (e.button !== 0) return;
  if (imageModalZoomState.scale <= IMAGE_MODAL_ZOOM_MIN + 0.001) return;
  if (e.target && e.target.closest('[data-image-modal-zoom]')) return;
  if (e.target && e.target.closest('[data-image-modal-filter]')) return;

  e.preventDefault();
  e.stopPropagation();

  imageModalZoomState.isPanning = true;
  imageModalZoomState.pointerId = e.pointerId;
  imageModalZoomState.startX = e.clientX;
  imageModalZoomState.startY = e.clientY;
  imageModalZoomState.startPanX = imageModalZoomState.panX;
  imageModalZoomState.startPanY = imageModalZoomState.panY;

  if (imageModalState.mediaEl.setPointerCapture) {
    try {
      imageModalState.mediaEl.setPointerCapture(e.pointerId);
    } catch (_) {
      // Ignore capture errors.
    }
  }
}

function onImageModalMediaWheel(e) {
  if (!imageModalState.isOpen) return;
  if (!imageModalState.imgEl || !imageModalState.imgEl.getAttribute('src')) return;
  if (e.target && e.target.closest('[data-image-modal-filter]')) return;

  e.preventDefault();
  const factor = e.deltaY < 0 ? IMAGE_MODAL_ZOOM_STEP : (1 / IMAGE_MODAL_ZOOM_STEP);
  zoomImageModalBy(factor);
}

function applyImageModalImageFilter() {
  if (!imageModalState.imgEl) return;

  const filters = [
    `brightness(${imageModalFilterState.brightness}%)`,
    `contrast(${imageModalFilterState.contrast}%)`,
    `saturate(${imageModalFilterState.saturation}%)`,
    `grayscale(${imageModalFilterState.grayscale}%)`,
    `invert(${imageModalFilterState.invert}%)`,
  ];

  imageModalState.imgEl.style.filter = filters.join(' ');
}

function syncImageModalFilterControls() {
  if (imageModalState.filterBrightnessEl) imageModalState.filterBrightnessEl.value = String(imageModalFilterState.brightness);
  if (imageModalState.filterContrastEl) imageModalState.filterContrastEl.value = String(imageModalFilterState.contrast);
  if (imageModalState.filterSaturationEl) imageModalState.filterSaturationEl.value = String(imageModalFilterState.saturation);
  if (imageModalState.filterGrayscaleEl) imageModalState.filterGrayscaleEl.value = String(imageModalFilterState.grayscale);
  if (imageModalState.filterInvertEl) imageModalState.filterInvertEl.value = String(imageModalFilterState.invert);
}

function refreshImageModalFiltersFromControls() {
  const read = (el, fallback) => {
    const n = Number(el && el.value);
    return Number.isFinite(n) ? n : fallback;
  };

  imageModalFilterState.brightness = read(imageModalState.filterBrightnessEl, IMAGE_MODAL_FILTER_DEFAULTS.brightness);
  imageModalFilterState.contrast = read(imageModalState.filterContrastEl, IMAGE_MODAL_FILTER_DEFAULTS.contrast);
  imageModalFilterState.saturation = read(imageModalState.filterSaturationEl, IMAGE_MODAL_FILTER_DEFAULTS.saturation);
  imageModalFilterState.grayscale = read(imageModalState.filterGrayscaleEl, IMAGE_MODAL_FILTER_DEFAULTS.grayscale);
  imageModalFilterState.invert = read(imageModalState.filterInvertEl, IMAGE_MODAL_FILTER_DEFAULTS.invert);

  applyImageModalImageFilter();
}

function resetImageModalFilters() {
  imageModalFilterState.brightness = IMAGE_MODAL_FILTER_DEFAULTS.brightness;
  imageModalFilterState.contrast = IMAGE_MODAL_FILTER_DEFAULTS.contrast;
  imageModalFilterState.saturation = IMAGE_MODAL_FILTER_DEFAULTS.saturation;
  imageModalFilterState.grayscale = IMAGE_MODAL_FILTER_DEFAULTS.grayscale;
  imageModalFilterState.invert = IMAGE_MODAL_FILTER_DEFAULTS.invert;
  syncImageModalFilterControls();
  applyImageModalImageFilter();
}

function syncImageModalFilterVisibility() {
  if (!imageModalState.filterControlsEl) return;
  const visible = !!imageModalState.filtersVisible;
  imageModalState.filterControlsEl.hidden = !visible;
  if (imageModalState.filterToggleBtnEl) {
    imageModalState.filterToggleBtnEl.setAttribute('aria-pressed', visible ? 'true' : 'false');
    imageModalState.filterToggleBtnEl.classList.toggle('is-active', visible);
  }
}

function setImageModalFilterVisibility(nextVisible) {
  imageModalState.filtersVisible = !!nextVisible;
  syncImageModalFilterVisibility();
}

function bindImageModalFilterEvents() {
  ensureImageModalInitialized();
  if (imageModalFilterState.eventsBound) return;

  const filterControls = [
    imageModalState.filterBrightnessEl,
    imageModalState.filterContrastEl,
    imageModalState.filterSaturationEl,
    imageModalState.filterGrayscaleEl,
    imageModalState.filterInvertEl,
  ].filter(Boolean);

  if (!filterControls.length) return;

  imageModalFilterState.eventsBound = true;

  filterControls.forEach(inputEl => {
    inputEl.addEventListener('input', refreshImageModalFiltersFromControls);
    inputEl.addEventListener('change', refreshImageModalFiltersFromControls);
  });

  if (imageModalState.filterResetBtnEl) {
    imageModalState.filterResetBtnEl.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      resetImageModalFilters();
    });
  }
}

function bindImageModalZoomEvents() {
  ensureImageModalInitialized();
  if (imageModalZoomState.eventsBound || !imageModalState.mediaEl || !imageModalState.imgEl) return;

  imageModalZoomState.eventsBound = true;

  imageModalState.mediaEl.addEventListener('wheel', onImageModalMediaWheel, { passive: false });
  imageModalState.mediaEl.addEventListener('pointerdown', onImageModalPanPointerDown);
  imageModalState.mediaEl.addEventListener('pointermove', onImageModalPanPointerMove);
  imageModalState.mediaEl.addEventListener('pointerup', onImageModalPanPointerUp);
  imageModalState.mediaEl.addEventListener('pointercancel', onImageModalPanPointerCancel);

  imageModalState.imgEl.addEventListener('load', () => {
    applyImageModalImageTransform();
  });

  if (imageModalState.zoomInBtnEl) {
    imageModalState.zoomInBtnEl.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      zoomImageModalBy(IMAGE_MODAL_ZOOM_STEP);
    });
  }

  if (imageModalState.zoomOutBtnEl) {
    imageModalState.zoomOutBtnEl.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      zoomImageModalBy(1 / IMAGE_MODAL_ZOOM_STEP);
    });
  }

  if (imageModalState.zoomResetBtnEl) {
    imageModalState.zoomResetBtnEl.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      resetImageModalZoom();
    });
  }
}

function suppressMapToImageHighlightUntilPointerMove() {
  suppressMapToImageHighlight = true;
}

function bindMapToImageResyncOnPointerMove() {
  if (!mapContainerEl || mapContainerEl.__plodMapToImageResyncBound) return;
  mapContainerEl.__plodMapToImageResyncBound = true;

  const clearSuppression = () => {
    suppressMapToImageHighlight = false;
  };

  mapContainerEl.addEventListener('pointermove', clearSuppression, { passive: true });
  mapContainerEl.addEventListener('pointerdown', clearSuppression, { passive: true });
}

function ensureImageModalInitialized() {
  if (imageModalState.overlayEl) return;

  const overlayEl = document.createElement('div');
  overlayEl.id = 'image-modal-overlay';
  overlayEl.className = 'image-modal-overlay';
  overlayEl.hidden = true;
  overlayEl.innerHTML =
    '<div class="image-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="image-modal-title">' +
      '<div class="image-modal-header">' +
        '<h2 id="image-modal-title" class="image-modal-title">Image</h2>' +
        '<div class="image-modal-header-actions">' +
          '<button type="button" class="image-modal-nav image-modal-nav-prev" data-image-modal-nav="prev" aria-label="Previous image" title="Previous image">←</button>' +
          '<button type="button" class="image-modal-nav image-modal-nav-next" data-image-modal-nav="next" aria-label="Next image" title="Next image">→</button>' +
        '<button type="button" class="image-modal-close" data-image-modal-close="button" aria-label="Close image modal">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="image-modal-content">' +
        '<div class="image-modal-media">' +
          '<div class="image-modal-filter-controls" data-image-modal-filter="controls" aria-label="Image adjustments" hidden>' +
            '<div class="image-modal-filter-grid">' +
              '<label class="image-modal-filter-item" title="Brightness"><span>B</span><input type="range" min="50" max="200" step="5" value="100" data-image-modal-filter="brightness" aria-label="Brightness"></label>' +
              '<label class="image-modal-filter-item" title="Contrast"><span>C</span><input type="range" min="50" max="200" step="5" value="100" data-image-modal-filter="contrast" aria-label="Contrast"></label>' +
              '<label class="image-modal-filter-item" title="Saturation"><span>S</span><input type="range" min="0" max="200" step="5" value="100" data-image-modal-filter="saturation" aria-label="Saturation"></label>' +
              '<label class="image-modal-filter-item" title="Grayscale"><span>G</span><input type="range" min="0" max="100" step="5" value="0" data-image-modal-filter="grayscale" aria-label="Grayscale"></label>' +
              '<label class="image-modal-filter-item" title="Invert"><span>I</span><input type="range" min="0" max="100" step="5" value="0" data-image-modal-filter="invert" aria-label="Invert"></label>' +
            '</div>' +
            '<button type="button" class="image-modal-filter-reset" data-image-modal-filter="reset" aria-label="Reset adjustments" title="Reset adjustments">Reset</button>' +
          '</div>' +
          '<div class="image-modal-zoom-controls" aria-label="Image zoom controls">' +
            '<button type="button" class="image-modal-zoom-btn" data-image-modal-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>' +
            '<button type="button" class="image-modal-zoom-btn" data-image-modal-zoom="out" aria-label="Zoom out" title="Zoom out">-</button>' +
            '<button type="button" class="image-modal-zoom-btn" data-image-modal-zoom="reset" aria-label="Reset zoom" title="Reset zoom">100%</button>' +
            '<button type="button" class="image-modal-tool-toggle" data-image-modal-toggle-filters="button" aria-label="Show image adjustments" title="Show image adjustments" aria-pressed="false">Adjust</button>' +
          '</div>' +
          '<img class="image-modal-img" alt="">' +
        '</div>' +
        '<aside class="image-modal-info" aria-live="polite">' +
          '<div class="image-modal-info-body"></div>' +
        '</aside>' +
      '</div>' +
      '<button type="button" class="image-modal-resize-handle" data-image-modal-resize-handle="true" aria-label="Resize image modal"></button>' +
    '</div>';

  document.body.appendChild(overlayEl);

  imageModalState.overlayEl = overlayEl;
  imageModalState.dialogEl = overlayEl.querySelector('.image-modal-dialog');
  imageModalState.headerEl = overlayEl.querySelector('.image-modal-header');
  imageModalState.titleEl = overlayEl.querySelector('.image-modal-title');
  imageModalState.mediaEl = overlayEl.querySelector('.image-modal-media');
  imageModalState.imgEl = overlayEl.querySelector('.image-modal-img');
  imageModalState.filterToggleBtnEl = overlayEl.querySelector('[data-image-modal-toggle-filters="button"]');
  imageModalState.filterControlsEl = overlayEl.querySelector('[data-image-modal-filter="controls"]');
  imageModalState.filterBrightnessEl = overlayEl.querySelector('[data-image-modal-filter="brightness"]');
  imageModalState.filterContrastEl = overlayEl.querySelector('[data-image-modal-filter="contrast"]');
  imageModalState.filterSaturationEl = overlayEl.querySelector('[data-image-modal-filter="saturation"]');
  imageModalState.filterGrayscaleEl = overlayEl.querySelector('[data-image-modal-filter="grayscale"]');
  imageModalState.filterInvertEl = overlayEl.querySelector('[data-image-modal-filter="invert"]');
  imageModalState.filterResetBtnEl = overlayEl.querySelector('[data-image-modal-filter="reset"]');
  imageModalState.infoEl = overlayEl.querySelector('.image-modal-info');
  imageModalState.infoBodyEl = overlayEl.querySelector('.image-modal-info-body');
  imageModalState.prevBtnEl = overlayEl.querySelector('.image-modal-nav-prev');
  imageModalState.nextBtnEl = overlayEl.querySelector('.image-modal-nav-next');
  imageModalState.zoomInBtnEl = overlayEl.querySelector('[data-image-modal-zoom="in"]');
  imageModalState.zoomOutBtnEl = overlayEl.querySelector('[data-image-modal-zoom="out"]');
  imageModalState.zoomResetBtnEl = overlayEl.querySelector('[data-image-modal-zoom="reset"]');
  imageModalState.closeBtnEl = overlayEl.querySelector('.image-modal-close');
  imageModalState.resizeHandleEl = overlayEl.querySelector('.image-modal-resize-handle');
}

function renderImageModalContent() {
  if (!imageModalState.titleEl || !imageModalState.imgEl || !imageModalState.infoBodyEl) return;

  const imageShort = imageModalState.imageUrn ? extractShortId(imageModalState.imageUrn) : 'image';
  imageModalState.titleEl.textContent = imageShort;
  const displayImageUrl = imageModalState.iiifImageUrl || imageModalState.imageUrl;
  const imageChanged = imageModalState.activeDisplayImageUrl !== displayImageUrl;
  if (displayImageUrl) {
    if (imageChanged || imageModalState.imgEl.src !== displayImageUrl) {
      imageModalState.imgEl.src = displayImageUrl;
    }
  } else {
    imageModalState.imgEl.removeAttribute('src');
  }
  imageModalState.activeDisplayImageUrl = displayImageUrl;
  if (imageChanged) resetImageModalZoom();
  if (imageChanged) resetImageModalFilters();
  imageModalState.imgEl.alt = imageShort;

  const imageUrnHtml = imageModalState.imageUrn
    ? `<div class="image-modal-info-row"><span class="image-modal-info-key">Image</span><span class="image-modal-info-value image-modal-info-value-urn">${renderImageModalUrnValue(imageModalState.imageUrn)}</span></div>`
    : '';
  const contextUrnHtml = imageModalState.contextUrn
    ? `<div class="image-modal-info-row"><span class="image-modal-info-key">Context</span><span class="image-modal-info-value image-modal-info-value-urn">${renderImageModalUrnValue(imageModalState.contextUrn)}</span></div>`
    : '';
  const captionHtml = imageModalState.imageCaption
    ? `<div class="image-modal-info-row"><span class="image-modal-info-key">Caption</span><p class="image-modal-caption">${formatImageModalCaptionHtml(imageModalState.imageCaption)}</p></div>`
    : '';
  const lunaLinkHtml = imageModalState.lunaLandingUrl
    ? `<div class="image-modal-info-row image-modal-luna-row"><span class="image-modal-info-key">Image info and credits:</span><a class="image-modal-luna-link" href="${escAttr(imageModalState.lunaLandingUrl)}" target="_blank" rel="noopener noreferrer">↗</a></div>`
    : '';
  const iiifManifestHtml = imageModalState.iiifManifestUrl
    ? `<div class="image-modal-info-row image-modal-luna-row"><span class="image-modal-info-key">IIIF manifest:</span><a class="image-modal-luna-link" href="${escAttr(imageModalState.iiifManifestUrl)}" target="_blank" rel="noopener noreferrer">↗</a></div>`
    : '';
  const miradorUrl = imageModalState.iiifManifestUrl
    ? `https://projectmirador.org/embed/?iiif-content=${encodeURIComponent(imageModalState.iiifManifestUrl)}`
    : '';
  const miradorHtml = miradorUrl
    ? `<div class="image-modal-info-row image-modal-luna-row"><span class="image-modal-info-key">View in Mirador:</span><a class="image-modal-luna-link" href="${escAttr(miradorUrl)}" target="_blank" rel="noopener noreferrer">↗</a></div>`
    : '';

  imageModalState.infoBodyEl.innerHTML =
    '<p class="image-modal-info-title">Details</p>' +
    imageUrnHtml +
    contextUrnHtml +
    captionHtml +
    lunaLinkHtml +
    iiifManifestHtml +
    miradorHtml;

  syncImageModalFilterVisibility();
  requestImageModalCaptionIfMissing();
}

function setImageModalVisibility(isOpen) {
  ensureImageModalInitialized();

  imageModalState.isOpen = !!isOpen;
  imageModalState.overlayEl.hidden = !isOpen;
  imageModalState.overlayEl.classList.toggle('is-open', !!isOpen);
  if (!isOpen) imageModalState.overlayEl.classList.remove('is-dragging');
  if (!isOpen) imageModalState.overlayEl.classList.remove('is-resizing');
  imageModalState.overlayEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  document.body.classList.toggle('has-image-modal', !!isOpen);

  if (!isOpen) {
    invalidateImageModalSequence();
    clearImageModalNavigationMapHighlight();
  }
}

function clearHighlightForModalTrigger(triggerEl) {
  if (!triggerEl) return;

  endImageTileHighlight(triggerEl);

  const entityUrn = triggerEl.dataset.entityUrn || '';
  if (entityUrn) {
    paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: entityUrn, source: 'image' });
  }

  const featureUrn = triggerEl.dataset.featureUrn || '';
  if (featureUrn) {
    void resolveFeatureToLayer(featureUrn).then(layerUrn => {
      if (layerUrn) paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: layerUrn, source: 'image' });
    });
  }
}

function openImageModal(payload = {}) {
  const normalized = normalizeImageModalPayload({
    ...payload,
    triggerEl: payload.triggerEl || document.activeElement || null,
  });
  if (!normalized) return;

  ensureImageModalInitialized();
  ensureImageModalInitialGeometry();

  clearHighlightForModalTrigger(normalized.triggerEl);
  applyImageModalPayload(normalized, { updateTriggerEl: true });
  suppressMapToImageHighlightUntilPointerMove();
  setImageModalFilterVisibility(false);
  resetImageModalZoom();
  resetImageModalFilters();

  renderImageModalContent();
  rebuildImageModalSequence(normalized);

  setImageModalVisibility(true);
  syncImageModalGeometryToViewport();
  imageModalState.ignoreOpenClickUntil = Date.now() + 180;
  imageModalState.closeBtnEl.focus();
}

function closeImageModal() {
  if (!imageModalState.overlayEl) return;
  const overlayIsVisible = !imageModalState.overlayEl.hidden || imageModalState.overlayEl.classList.contains('is-open');
  if (!imageModalState.isOpen && !overlayIsVisible) return;

  endImageModalDrag(null, false);
  endImageModalResize(null, false);
  endImageModalPan(null);

  setImageModalVisibility(false);

  if (imageModalState.imgEl) imageModalState.imgEl.removeAttribute('src');
  if (imageModalState.imgEl) imageModalState.imgEl.style.removeProperty('filter');

  const focusTarget = imageModalState.triggerEl;
  imageModalState.imageUrl = '';
  imageModalState.imageUrn = '';
  imageModalState.contextUrn = '';
  imageModalState.imageCaption = '';
  imageModalState.lunaLandingUrl = '';
  imageModalState.iiifManifestUrl = '';
  imageModalState.iiifImageUrl = '';
  imageModalState.activeDisplayImageUrl = '';
  setImageModalFilterVisibility(false);
  resetImageModalFilters();
  imageModalState.triggerEl = null;
  imageModalState.ignoreOpenClickUntil = 0;
  imageModalState.captionRequestToken += 1;

  suppressMapToImageHighlightUntilPointerMove();

  if (focusTarget && typeof focusTarget.focus === 'function' && document.contains(focusTarget)) {
    imageModalState.suppressFocusHighlightEl = focusTarget;
    focusTarget.focus();
  } else {
    imageModalState.suppressFocusHighlightEl = null;
  }
}

function initImageModalEvents() {
  ensureImageModalInitialized();
  bindImageModalDragEvents();
  bindImageModalResizeEvents();
  bindImageModalZoomEvents();
  bindImageModalFilterEvents();
  setImageModalVisibility(false);
  if (imageModalState.eventsBound) return;
  imageModalState.eventsBound = true;

  paneEvents.on(UI_EVENT_IMAGE_MODAL_OPEN, payload => {
    openImageModal(payload || {});
  });

  paneEvents.on(UI_EVENT_IMAGE_MODAL_CLOSE, () => {
    closeImageModal();
  });

  imageModalState.overlayEl.addEventListener('click', e => {
    const ignoreUntil = Math.max(
      imageModalState.ignoreOpenClickUntil,
      imageModalDragState.ignoreOverlayClickUntil,
      imageModalResizeState.ignoreOverlayClickUntil
    );
    if (imageModalDragState.isDragging || imageModalResizeState.isResizing || Date.now() < ignoreUntil) {
      return;
    }

    const navBtn = e.target.closest('[data-image-modal-nav]');
    if (navBtn) {
      e.preventDefault();
      e.stopPropagation();
      const dir = navBtn.dataset.imageModalNav === 'prev' ? -1 : 1;
      stepImageModalSequence(dir);
      return;
    }

    if (e.target.closest('[data-image-modal-close]')) {
      paneEvents.emit(UI_EVENT_IMAGE_MODAL_CLOSE);
    }
  });

  if (imageModalState.infoEl) {
    imageModalState.infoEl.addEventListener('click', e => {
      const navBtn = e.target.closest('[data-image-modal-navigate]');
      if (!navBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const urn = String(navBtn.dataset.imageModalNavigate || '');
      if (!urn) return;
      navigate(extractShortId(urn));
    });
  }

  if (imageModalState.filterToggleBtnEl) {
    imageModalState.filterToggleBtnEl.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setImageModalFilterVisibility(!imageModalState.filtersVisible);
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && imageModalState.isOpen) {
      e.preventDefault();
      if (imageModalDragState.isDragging) {
        endImageModalDrag(null, false);
        return;
      }
      if (imageModalResizeState.isResizing) {
        endImageModalResize(null, false);
        return;
      }
      paneEvents.emit(UI_EVENT_IMAGE_MODAL_CLOSE);
      return;
    }

    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && imageModalState.isOpen) {
      if (imageModalDragState.isDragging || imageModalResizeState.isResizing) return;
      e.preventDefault();
      stepImageModalSequence(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (imageModalState.isOpen && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0')) {
      if (imageModalDragState.isDragging || imageModalResizeState.isResizing) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomImageModalBy(IMAGE_MODAL_ZOOM_STEP);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomImageModalBy(1 / IMAGE_MODAL_ZOOM_STEP);
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        resetImageModalZoom();
      }
    }
  });
}

function wireImageModalOpenEvents(containerEl) {
  if (!containerEl) return;

  containerEl.querySelectorAll('[data-image-url]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const imageUrl = el.dataset.imageUrl;
      if (!imageUrl) return;

      e.preventDefault();
      e.stopPropagation();

      paneEvents.emit(UI_EVENT_IMAGE_MODAL_OPEN, {
        imageUrl,
        imageUrn: el.dataset.imageUrn || el.dataset.entityUrn || '',
        contextUrn: el.dataset.featureUrn || el.dataset.entityUrn || '',
        imageCaption: el.dataset.imageCaption || '',
        triggerEl: el,
      });
    });
  });
}

function registerFirstImageAssociation(entityUrn, imageEl) {
  if (!entityUrn || !imageEl) return;
  if (!firstImageElByEntityUrn.has(entityUrn)) {
    firstImageElByEntityUrn.set(entityUrn, imageEl);
  }
}

function highlightAndScrollToFirstAssociatedImage(entityUrn) {
  if (!entityUrn) return;

  const imageEl = firstImageElByEntityUrn.get(entityUrn);
  if (!imageEl) return null;

  if (activeMapHoverImageEl && activeMapHoverImageEl !== imageEl) {
    setImageHoverState(activeMapHoverImageEl, false);
  }

  activeMapHoverImageEl = imageEl;
  setImageHoverState(imageEl, true);
  imageEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  return imageEl;
}

function cancelAttentionPulseForUrn(urn) {
  if (!attentionPulseTimeoutByUrn.has(urn)) return;
  clearTimeout(attentionPulseTimeoutByUrn.get(urn));
  attentionPulseTimeoutByUrn.delete(urn);
}

function cancelAllAttentionPulses() {
  for (const timeoutId of attentionPulseTimeoutByUrn.values()) {
    clearTimeout(timeoutId);
  }
  attentionPulseTimeoutByUrn.clear();
}

function shouldRunFarZoomAttentionPulse(source) {
  return source !== 'map';
}

function runFarZoomAttentionPulse(urn, entry) {
  if (!entry || !entry.layer) return;

  cancelAttentionPulseForUrn(urn);

  entry.layer.setStyle({ ...HIGHLIGHT_STYLE, color: '#ffe066', weight: 12, fillOpacity: 0.85 });

  const timeoutId = setTimeout(() => {
    if (currentHoveredEntityUrn !== urn) return;
    entry.layer.setStyle({ ...HIGHLIGHT_STYLE, color: '#ffb300', weight: 8, fillOpacity: 0.68 });

    const settleTimeoutId = setTimeout(() => {
      if (currentHoveredEntityUrn !== urn) return;
      entry.layer.setStyle(HIGHLIGHT_STYLE);
      attentionPulseTimeoutByUrn.delete(urn);
    }, 140);

    attentionPulseTimeoutByUrn.set(urn, settleTimeoutId);
  }, 140);

  attentionPulseTimeoutByUrn.set(urn, timeoutId);
}

function initModifierKeyTracking() {
  window.addEventListener('keydown', e => {
    if (e.key === 'Alt') isOptionKeyDown = true;
    if (e.key === 'Control') isCtrlKeyDown = true;
  });

  window.addEventListener('keyup', e => {
    if (e.key === 'Alt') isOptionKeyDown = false;
    if (e.key === 'Control') isCtrlKeyDown = false;
  });

  window.addEventListener('blur', () => {
    isOptionKeyDown = false;
    isCtrlKeyDown = false;
  });
}

function isAltGraphActive(evt) {
  return !!(evt && typeof evt.getModifierState === 'function' && evt.getModifierState('AltGraph'));
}

function shouldPanFromEvent(evt) {
  return !!(evt && evt.altKey) && !isAltGraphActive(evt);
}

function isPanModifierDown() {
  // AltGr is effectively Ctrl+Alt on many layouts; ignore that combination.
  return isOptionKeyDown && !isCtrlKeyDown;
}

function ensureMapContainerInSlot(slotEl) {
  if (!slotEl) return null;

  if (!mapContainerEl) {
    mapContainerEl = document.createElement('div');
    mapContainerEl.id = 'map';
  }

  if (mapContainerEl.parentElement !== slotEl) {
    slotEl.innerHTML = '';
    slotEl.appendChild(mapContainerEl);
  }

  return mapContainerEl;
}

function ensureMapInitialized(slotEl) {
  const container = ensureMapContainerInSlot(slotEl);
  if (!container) return;
  bindMapToImageResyncOnPointerMove();

  if (!leafletMap) {
    leafletMap = L.map(container, { zoomControl: true });
    L.tileLayer('http://palp.art/xyz-tiles/{z}/{x}/{y}.png', {
      attribution: '<a href="https://websites.umass.edu/pbmp/">PBMP</a>',
      maxZoom: 19,
    }).addTo(leafletMap);
    layerGroup = L.layerGroup().addTo(leafletMap);
    leafletMap.setView([DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lng], DEFAULT_MAP_VIEW.zoom);
  } else {
    leafletMap.invalidateSize();
  }
}

function ensureMapFocusHintElement() {
  if (!mapContainerEl) return null;

  if (!mapFocusHintEl) {
    mapFocusHintEl = document.createElement('div');
    mapFocusHintEl.id = 'map-focus-hint';
    mapFocusHintEl.textContent = 'Hold down option/alt key when hovering over image to focus map.';
  }

  if (mapFocusHintEl.parentElement !== mapContainerEl) {
    mapContainerEl.appendChild(mapFocusHintEl);
  }

  return mapFocusHintEl;
}

function showMapFocusHint() {
  const hintEl = ensureMapFocusHintElement();
  if (!hintEl) return;

  if (mapFocusHintTimeoutId) {
    clearTimeout(mapFocusHintTimeoutId);
    mapFocusHintTimeoutId = null;
  }

  hintEl.classList.remove('is-visible');
  void hintEl.offsetWidth;
  hintEl.classList.add('is-visible');

  mapFocusHintTimeoutId = setTimeout(() => {
    hintEl.classList.remove('is-visible');
    mapFocusHintTimeoutId = null;
  }, 3400);
}

function isMapAtDefaultView() {
  if (!leafletMap) return true;

  const center = leafletMap.getCenter();
  const zoom = leafletMap.getZoom();
  return (
    Math.abs(center.lat - DEFAULT_MAP_VIEW.lat) <= MAP_VIEW_EPSILON.latLng
    && Math.abs(center.lng - DEFAULT_MAP_VIEW.lng) <= MAP_VIEW_EPSILON.latLng
    && Math.abs(zoom - DEFAULT_MAP_VIEW.zoom) <= MAP_VIEW_EPSILON.zoom
  );
}

function applyPendingMapViewOverride() {
  if (!leafletMap || !pendingMapViewOverride) return;

  const { lat, lng, zoom } = pendingMapViewOverride;
  leafletMap.setView([lat, lng], zoom, { animate: false });
  pendingMapViewOverride = null;
}

function initMapUrlSync() {
  if (!leafletMap || leafletMap.__plodUrlSyncBound) return;
  leafletMap.__plodUrlSyncBound = true;

  const syncUrl = () => updateUrlWithRatios();
  leafletMap.on('moveend', syncUrl);
  leafletMap.on('zoomend', syncUrl);
  leafletMap.on('dragend', syncUrl);
}

function clearMapLayers() {
  cancelAllAttentionPulses();
  clearHierarchyPreview();
  if (mapFocusHintTimeoutId) {
    clearTimeout(mapFocusHintTimeoutId);
    mapFocusHintTimeoutId = null;
  }
  if (mapFocusHintEl) mapFocusHintEl.classList.remove('is-visible');
  if (layerGroup) layerGroup.clearLayers();
  layersByEntityUrn.clear();
  spatialHoverCache.clear();
  ancestorByEntityUrnCache.clear();
  ancestorOutlineLayerCache.clear();
  pendingAncestorByEntityUrn.clear();
  pendingAncestorOutlineLayerByUrn.clear();
  activeAncestorOutlineUrn = null;
  currentHoveredEntityUrn = null;
}

async function resolveAncestorForEntity(entityUrn) {
  if (!entityUrn) return null;
  if (ancestorByEntityUrnCache.has(entityUrn)) {
    return ancestorByEntityUrnCache.get(entityUrn);
  }
  if (pendingAncestorByEntityUrn.has(entityUrn)) {
    return pendingAncestorByEntityUrn.get(entityUrn);
  }

  const pending = (async () => {
    try {
      const shortId = extractShortId(entityUrn);
      const r = await fetch(`${API_BASE}/spatial-ancestors/${encodeURIComponent(shortId)}`);
      if (!r.ok) return null;

      const ancestors = await r.json();
      if (!Array.isArray(ancestors)) return null;

      // /spatial-ancestors is child-first. Use the first true ancestor
      // by position so behavior is generic and type-agnostic.
      const firstTrueAncestor = ancestors.find((a, idx) => idx > 0 && a && a.urn);
      if (firstTrueAncestor) return firstTrueAncestor.urn;

      const firstWithUrn = ancestors.find(a => a && a.urn);
      return firstWithUrn ? firstWithUrn.urn : null;
    } catch (_) {
      return null;
    } finally {
      pendingAncestorByEntityUrn.delete(entityUrn);
    }
  })();

  pendingAncestorByEntityUrn.set(entityUrn, pending);
  const resolved = await pending;
  ancestorByEntityUrnCache.set(entityUrn, resolved);
  return resolved;
}

async function ensureAncestorOutlineLayer(ancestorUrn) {
  if (!ancestorUrn) return null;
  if (ancestorOutlineLayerCache.has(ancestorUrn)) return ancestorOutlineLayerCache.get(ancestorUrn);
  if (pendingAncestorOutlineLayerByUrn.has(ancestorUrn)) return pendingAncestorOutlineLayerByUrn.get(ancestorUrn);

  const pending = (async () => {
    try {
      const shortId = extractShortId(ancestorUrn);
      const r = await fetch(`${API_BASE}/geojson/${encodeURIComponent(shortId)}`);
      if (!r.ok) return null;

      const payload = await r.json();
      const parsed = parseGeoJson(payload && payload.geojson ? payload.geojson : payload);
      if (!parsed) return null;

      const layer = L.geoJSON(parsed, {
        style: { ...ANCESTOR_OUTLINE_STYLE, className: 'plod-ancestor-outline' },
        interactive: false,
      });
      ancestorOutlineLayerCache.set(ancestorUrn, layer);
      return layer;
    } catch (_) {
      return null;
    } finally {
      pendingAncestorOutlineLayerByUrn.delete(ancestorUrn);
    }
  })();

  pendingAncestorOutlineLayerByUrn.set(ancestorUrn, pending);
  return pending;
}

function hideActiveAncestorOutline() {
  if (!activeAncestorOutlineUrn || !layerGroup) return;
  const layer = ancestorOutlineLayerCache.get(activeAncestorOutlineUrn);
  if (!layer) {
    activeAncestorOutlineUrn = null;
    return;
  }

  if (layerGroup.hasLayer(layer)) layerGroup.removeLayer(layer);
  activeAncestorOutlineUrn = null;
}

async function showAncestorOutlineForHoveredEntity(entityUrn) {
  if (!entityUrn || !layerGroup) return;

  const ancestorUrn = await resolveAncestorForEntity(entityUrn);
  if (!ancestorUrn) return;
  if (currentHoveredEntityUrn !== entityUrn) return;

  const layer = await ensureAncestorOutlineLayer(ancestorUrn);
  if (!layer) return;
  if (currentHoveredEntityUrn !== entityUrn) return;

  if (activeAncestorOutlineUrn && activeAncestorOutlineUrn !== ancestorUrn) {
    hideActiveAncestorOutline();
  }

  if (!layerGroup.hasLayer(layer)) layer.addTo(layerGroup);
  // Keep ancestor outline above the general map geometry.
  layer.bringToFront();

  activeAncestorOutlineUrn = ancestorUrn;
}

function renderPlaceholderInSlot(slotEl, text = '—') {
  if (!slotEl) return;
  slotEl.innerHTML = `<p class="placeholder">${escHtml(text)}</p>`;
}

function renderLoadingInSlot(slotEl, text = 'Loading…') {
  if (!slotEl) return;
  slotEl.innerHTML = `<p class="loading">${escHtml(text)}</p>`;
}

function renderHierarchyPlaceholder(slotEl, profile) {
  if (!slotEl) return;

  let msg = 'Hierarchy browser coming soon.';
  if (profile === 'concept') msg = 'Concept hierarchy browser coming soon.';
  if (profile === 'spatial') msg = 'Spatial hierarchy browser coming soon.';
  slotEl.innerHTML = `<p class="placeholder">${escHtml(msg)}</p>`;
}

function normalizeHierarchyNode(item) {
  if (!item) return null;

  const rawUrn = typeof item === 'string' ? item : (item.urn || item.id || item.p_lod_id || '');
  const urn = normalizeId(rawUrn);
  if (!urn) return null;

  const label = typeof item.label === 'string' && item.label.trim()
    ? item.label.trim()
    : extractShortId(urn);
  const type = item.type ? extractShortId(item.type) : '';

  return {
    urn,
    label,
    type,
    geojson: item.geojson || null,
  };
}

function normalizeHierarchyNodes(items, excludeUrns = new Set()) {
  if (!Array.isArray(items)) return [];

  const out = [];
  const seen = new Set();
  for (const item of items) {
    const normalized = normalizeHierarchyNode(item);
    if (!normalized) continue;
    if (excludeUrns.has(normalized.urn)) continue;
    if (seen.has(normalized.urn)) continue;
    seen.add(normalized.urn);
    out.push(normalized);
  }
  return out;
}

function upsertHierarchyNode(state, node) {
  if (!state || !node || !node.urn) return null;

  const existing = state.nodeMetaByUrn.get(node.urn);
  if (existing) {
    if (!existing.label && node.label) existing.label = node.label;
    if (!existing.type && node.type) existing.type = node.type;
    if (!existing.geojson && node.geojson) existing.geojson = node.geojson;
    return existing;
  }

  const cloned = { ...node };
  state.nodeMetaByUrn.set(node.urn, cloned);
  return cloned;
}

function recordHierarchyNodes(state, nodes) {
  return nodes.map(node => upsertHierarchyNode(state, node)).filter(Boolean);
}

async function fetchHierarchyItems(endpoint) {
  try {
    const r = await fetch(endpoint);
    if (!r.ok) return [];
    const payload = await r.json();
    return Array.isArray(payload) ? payload : [];
  } catch (_) {
    return [];
  }
}

async function fetchConceptualHierarchyAncestors(urn) {
  const items = await fetchHierarchyItems(`${API_BASE}/conceptual-ancestors/${encodeURIComponent(extractShortId(urn))}`);
  return normalizeHierarchyNodes(items, new Set([urn])).reverse();
}

async function fetchConceptualHierarchyChildren(urn) {
  const items = await fetchHierarchyItems(`${API_BASE}/conceptual-children/${encodeURIComponent(extractShortId(urn))}`);
  return normalizeHierarchyNodes(items, new Set([urn]));
}

async function fetchSpatialHierarchyAncestors(urn) {
  const items = await fetchHierarchyItems(`${API_BASE}/spatial-ancestors/${encodeURIComponent(extractShortId(urn))}`);
  return normalizeHierarchyNodes(items, new Set([urn])).reverse();
}

async function fetchSpatialHierarchyChildren(urn) {
  const items = await fetchHierarchyItems(`${API_BASE}/spatial-children/${encodeURIComponent(extractShortId(urn))}`);
  return normalizeHierarchyNodes(items, new Set([urn, DEFAULT_ID]));
}

function createHierarchyState(profile, currentNode, ancestors, children) {
  const state = {
    profile,
    currentNode: { ...currentNode },
    ancestors: [],
    nodeMetaByUrn: new Map(),
    childrenByParentUrn: new Map(),
    expandedUrns: new Set([currentNode.urn]),
    loadingUrns: new Set(),
    leafUrns: new Set(),
  };

  upsertHierarchyNode(state, currentNode);
  state.ancestors = recordHierarchyNodes(state, ancestors);
  state.childrenByParentUrn.set(currentNode.urn, recordHierarchyNodes(state, children));
  return state;
}

async function buildHierarchyState(profile, currentNode) {
  if (!currentNode || !currentNode.urn) return null;

  if (profile === 'concept') {
    const [ancestors, children] = await Promise.all([
      fetchConceptualHierarchyAncestors(currentNode.urn),
      fetchConceptualHierarchyChildren(currentNode.urn),
    ]);
    return createHierarchyState('concept', currentNode, ancestors, children);
  }

  if (profile === 'spatial') {
    const [ancestors, children] = await Promise.all([
      fetchSpatialHierarchyAncestors(currentNode.urn),
      fetchSpatialHierarchyChildren(currentNode.urn),
    ]);
    return createHierarchyState('spatial', currentNode, ancestors, children);
  }

  return null;
}

function getHierarchySlot() {
  return getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER);
}

function renderHierarchyLine(node, kind = 'ancestor') {
  const typeHtml = node.type ? `<span class="hierarchy-node-type">${escHtml(node.type)}</span>` : '';
  return `<div class="hierarchy-node hierarchy-node-${kind}">` +
         `<span class="hierarchy-node-main">` +
         `<span class="hierarchy-node-label">${escHtml(node.label)}</span>${typeHtml}</span>` +
         `<button type="button" class="hierarchy-go" data-hierarchy-go="${escAttr(node.urn)}" aria-label="Go to ${escAttr(extractShortId(node.urn))}" title="Go to ${escAttr(extractShortId(node.urn))}">↗</button>` +
         `</div>`;
}

function renderHierarchyBranch(node, state) {
  const children = state.childrenByParentUrn.get(node.urn) || [];
  const isExpanded = state.expandedUrns.has(node.urn);
  const isLoading = state.loadingUrns.has(node.urn);
  const isLeaf = state.leafUrns.has(node.urn);
  const typeHtml = node.type ? `<span class="hierarchy-node-type">${escHtml(node.type)}</span>` : '';

  let toggleHtml = '<span class="hierarchy-toggle hierarchy-toggle-spacer"></span>';
  if (isLoading) {
    toggleHtml = '<span class="hierarchy-toggle hierarchy-toggle-loading">…</span>';
  } else if (!isLeaf) {
    toggleHtml = `<button type="button" class="hierarchy-toggle" data-hierarchy-toggle="${escAttr(node.urn)}" aria-label="Toggle descendants">${isExpanded && children.length ? '−' : '+'}</button>`;
  }

  const nestedHtml = isExpanded && children.length
    ? `<ul class="hierarchy-children">${children.map(child => renderHierarchyBranch(child, state)).join('')}</ul>`
    : '';

  return `<li class="hierarchy-item">` +
         `<div class="hierarchy-row">${toggleHtml}` +
         `<button type="button" class="hierarchy-node hierarchy-node-child" data-hierarchy-preview="${escAttr(node.urn)}">` +
      `<span class="hierarchy-node-main">` +
      `<span class="hierarchy-node-label">${escHtml(node.label)}</span>${typeHtml}</span>` +
      `<span class="hierarchy-node-actions">` +
      `<button type="button" class="hierarchy-go" data-hierarchy-go="${escAttr(node.urn)}" aria-label="Go to ${escAttr(extractShortId(node.urn))}" title="Go to ${escAttr(extractShortId(node.urn))}">↗</button>` +
      `</span></button></div>${nestedHtml}</li>`;
}

function renderHierarchyState(slotEl, state) {
  if (!slotEl || !state) return;

  const children = state.childrenByParentUrn.get(state.currentNode.urn) || [];
  const ancestorHtml = state.ancestors.length
    ? `<div class="hierarchy-section"><div class="hierarchy-section-label-inline">Ancestors</div>` +
      `<div class="hierarchy-ancestor-list">${state.ancestors.map(node => renderHierarchyLine(node, 'ancestor')).join('')}</div></div>`
    : '';

  const childrenHtml = children.length
    ? `<ul class="hierarchy-tree">${children.map(node => renderHierarchyBranch(node, state)).join('')}</ul>`
    : '<p class="placeholder">No child nodes.</p>';

  slotEl.innerHTML = `<div class="hierarchy-browser hierarchy-browser-${escAttr(state.profile)}">` +
    ancestorHtml +
    `<div class="hierarchy-section"><div class="hierarchy-section-label-inline">Current</div>${renderHierarchyLine(state.currentNode, 'current')}</div>` +
    `<div class="hierarchy-section"><div class="hierarchy-section-label-inline">Children</div>${childrenHtml}</div>` +
    `</div>`;

  wireHierarchyInteractions(slotEl);
}

function rerenderHierarchy() {
  const slotEl = getHierarchySlot();
  if (!slotEl) return;
  if (!hierarchyState) {
    renderHierarchyPlaceholder(slotEl, currentResourceProfile);
    return;
  }
  renderHierarchyState(slotEl, hierarchyState);
}

function clearHierarchyPreview() {
  hierarchyPreviewRequestToken += 1;
  if (hierarchyPreviewLayer && layerGroup && layerGroup.hasLayer(hierarchyPreviewLayer)) {
    layerGroup.removeLayer(hierarchyPreviewLayer);
  }
  hierarchyPreviewLayer = null;
  hierarchyPreviewUrn = null;
}

function clearHierarchyState() {
  hierarchyState = null;
  clearHierarchyPreview();
}

async function ensureHierarchyNodeGeojson(urn) {
  if (!hierarchyState) return null;

  const node = hierarchyState.nodeMetaByUrn.get(urn);
  if (!node) return null;
  if (node.geojson && node.geojson !== 'None') return node.geojson;

  try {
    const r = await fetch(`${API_BASE}/geojson/${encodeURIComponent(extractShortId(urn))}`);
    if (!r.ok) return null;
    const payload = await r.json();
    node.geojson = payload && payload.geojson ? payload.geojson : payload;
    return node.geojson;
  } catch (_) {
    return null;
  }
}

async function previewHierarchyNode(urn) {
  if (!urn || !hierarchyState || hierarchyState.currentNode.urn === urn) return;
  if (hierarchyPreviewUrn === urn) return;

  clearHierarchyPreview();
  const requestToken = hierarchyPreviewRequestToken;
  const geojsonData = await ensureHierarchyNodeGeojson(urn);
  if (requestToken !== hierarchyPreviewRequestToken) return;

  const parsed = parseGeoJson(geojsonData);
  if (!parsed || !layerGroup) return;

  hierarchyPreviewLayer = L.geoJSON(parsed, {
    style: { ...HIERARCHY_PREVIEW_STYLE, className: 'plod-hierarchy-preview' },
    interactive: false,
  }).addTo(layerGroup);
  hierarchyPreviewLayer.bringToFront();
  hierarchyPreviewUrn = urn;
}

function clearHierarchyPreviewIfMatchingUrn(urn) {
  if (!urn) return;
  if (hierarchyPreviewUrn !== urn) return;
  clearHierarchyPreview();
}

async function toggleHierarchyNode(urn) {
  if (!hierarchyState || !urn) return;

  const state = hierarchyState;

  if (state.loadingUrns.has(urn)) return;
  if (state.childrenByParentUrn.has(urn)) {
    if (state.expandedUrns.has(urn)) {
      state.expandedUrns.delete(urn);
    } else {
      state.expandedUrns.add(urn);
    }
    rerenderHierarchy();
    return;
  }

  state.loadingUrns.add(urn);
  rerenderHierarchy();

  const children = state.profile === 'concept'
    ? await fetchConceptualHierarchyChildren(urn)
    : await fetchSpatialHierarchyChildren(urn);

  if (hierarchyState !== state || !state.loadingUrns.has(urn)) return;

  state.loadingUrns.delete(urn);
  const normalizedChildren = recordHierarchyNodes(state, children);
  state.childrenByParentUrn.set(urn, normalizedChildren);
  if (normalizedChildren.length) {
    state.expandedUrns.add(urn);
  } else {
    state.leafUrns.add(urn);
  }
  rerenderHierarchy();
}

function wireHierarchyInteractions(slotEl) {
  if (!slotEl) return;

  slotEl.querySelectorAll('[data-hierarchy-toggle]').forEach(button => {
    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      void toggleHierarchyNode(button.dataset.hierarchyToggle);
    });
  });

  slotEl.querySelectorAll('[data-hierarchy-preview]').forEach(button => {
    button.addEventListener('mouseenter', () => {
      void previewHierarchyNode(button.dataset.hierarchyPreview);
    });
    button.addEventListener('mouseleave', () => {
      clearHierarchyPreviewIfMatchingUrn(button.dataset.hierarchyPreview);
    });
    button.addEventListener('focus', () => {
      void previewHierarchyNode(button.dataset.hierarchyPreview);
    });
    button.addEventListener('blur', () => {
      clearHierarchyPreviewIfMatchingUrn(button.dataset.hierarchyPreview);
    });
  });

  slotEl.querySelectorAll('[data-hierarchy-go]').forEach(button => {
    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const urn = button.dataset.hierarchyGo;
      if (urn) navigate(extractShortId(urn));
    });
  });
}

// ── Panel: Info ───────────────────────────────────────────────────────────────

function renderInfo(triples, el) {
  if (!el) return;

  if (!Object.keys(triples).length) {
    el.innerHTML = '<p class="placeholder">No information available.</p>';
    return;
  }

  const label   = (triples['http://www.w3.org/2000/01/rdf-schema#label'] || [])[0] || '';
  const typeUrn = (triples['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'] || [])[0] || '';

  let html = '';
  if (label)   html += `<p class="entity-title">${escHtml(label)}</p>`;
  if (typeUrn) html += `<p class="entity-type">${escHtml(extractShortId(typeUrn))}</p>`;

  html += '<table><tbody>';
  for (const [pred, vals] of Object.entries(triples)) {
    if (SKIP_PREDICATES.has(pred)) continue;
    const predLabel   = humanizePredicate(pred);
    const cellContent = vals.map(v => {
      if (isHttpUrl(v)) {
        return `<a href="${escAttr(v)}" target="_blank" rel="noopener noreferrer">${escHtml(v)}</a>`;
      }
      if (String(v).startsWith('urn:p-lod:id:')) {
        const short = extractShortId(v);
        return `<a href="#" data-navigate="${escAttr(short)}">${escHtml(short)}</a>`;
      }
      return escHtml(String(v));
    }).join('<br>');
    html += `<tr><th>${escHtml(predLabel)}</th><td>${cellContent}</td></tr>`;
  }
  html += '</tbody></table>';

  el.innerHTML = html;

  // Wire internal P-LOD links to the router
  el.querySelectorAll('[data-navigate]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigate(a.dataset.navigate);
    });
  });
}

// ── Panel: Images ─────────────────────────────────────────────────────────────

async function resolveImageUrl(imgDict) {
  const urn = typeof imgDict === 'string' ? imgDict : imgDict.urn;
  if (!urn) return null;

  // Check if the /images/ response already included a direct URL field
  if (typeof imgDict === 'object') {
    const direct = imgDict.url || imgDict.image_url || imgDict.iiif_url;
    if (direct) return { urn, url: direct };
  }

  // Fallback: call /id/{shortId} and look for any HTTP URL value
  try {
    const r = await fetch(`${API_BASE}/id/${encodeURIComponent(extractShortId(urn))}`);
    if (!r.ok) return { urn, url: null };
    const t = flattenTriples(await r.json());
    for (const vals of Object.values(t)) {
      for (const v of vals) {
        if (isHttpUrl(v)) return { urn, url: v };
      }
    }
  } catch (_) { /* ignore */ }

  return { urn, url: null };
}

function renderImages(images, el) {
  if (!el) return;

  if (!images || !images.length) {
    el.innerHTML = '<p class="placeholder">No images available.</p>';
    return;
  }

  el.innerHTML = '<p class="loading">Loading images…</p>';

  // Build feature URN lookup before resolving URLs (resolveImageUrl discards the feature field)
  const featureByUrn = new Map();
  const captionByUrn = new Map();
  for (const img of images) {
    if (img && img.urn && img.feature) featureByUrn.set(img.urn, img.feature);
    if (img && img.urn) captionByUrn.set(img.urn, normalizeImageModalCaption(img.l_description || img.x_luna_description || ''));
  }

  Promise.all(images.map(resolveImageUrl)).then(results => {
    const valid = results.filter(Boolean);
    if (!valid.length) {
      el.innerHTML = '<p class="placeholder">No images available.</p>';
      return;
    }

    let html = '<div class="image-grid">';
    for (const { urn, url } of valid) {
      const short = extractShortId(urn);
      const featureUrn = featureByUrn.get(urn) || '';
      const caption = captionByUrn.get(urn) || '';
      const featureAttr = featureUrn ? ` data-feature-urn="${escAttr(featureUrn)}"` : '';
      const captionAttr = caption ? ` data-image-caption="${escAttr(caption)}"` : '';
      if (url) {
        html += `<a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer" data-image-url="${escAttr(url)}" data-image-urn="${escAttr(urn)}"${featureAttr}${captionAttr}>` +
                `<img src="${escAttr(url)}" alt="${escAttr(short)}" title="${escAttr(short)}" loading="lazy">` +
                `</a>`;
      } else {
        html += `<div class="image-urn-fallback"${featureAttr}${captionAttr} title="${escAttr(urn)}">${escHtml(short)}</div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
    invalidateImageModalSequence();
    wireSpatialImageHoverEvents(el);
    wireImageModalOpenEvents(el);
  });
}

function wireImageHoverEvents(containerEl) {
  containerEl.querySelectorAll('[data-entity-urn], [data-space-urn]').forEach(el => {
    const urn = el.dataset.entityUrn || el.dataset.spaceUrn;
    if (urn) registerFirstImageAssociation(urn, el);

    el.addEventListener('mouseenter', e => {
      const shouldPan = shouldPanFromEvent(e);
      scheduleImageHoverIntent(el, () => {
        if (!el.matches(':hover')) return;
        beginImageTileHighlight(el);
        syncOpenImageModalFromElement(el, urn);
        paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn, shouldPan, source: 'image' });
      });
    });
    el.addEventListener('mouseleave', () => {
      cancelImageHoverIntent(el);
      endImageTileHighlight(el);
      paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn });
    });
    el.addEventListener('focus', () => {
      cancelImageHoverIntent(el);
      if (shouldSuppressImageFocusHighlight(el)) return;
      beginImageTileHighlight(el);
      syncOpenImageModalFromElement(el, urn);
      paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn, shouldPan: isPanModifierDown(), source: 'image' });
    });
    el.addEventListener('blur', () => {
      cancelImageHoverIntent(el);
      endImageTileHighlight(el);
      paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn });
    });
  });
}

async function resolveFeatureToLayer(featureUrn) {
  if (spatialHoverCache.has(featureUrn)) return spatialHoverCache.get(featureUrn);

  // Direct match (edge case: feature URN is itself a registered layer)
  if (layersByEntityUrn.has(featureUrn)) {
    spatialHoverCache.set(featureUrn, featureUrn);
    return featureUrn;
  }

  try {
    const shortId = extractShortId(featureUrn);
    const r = await fetch(`${API_BASE}/spatial-ancestors/${encodeURIComponent(shortId)}`);
    if (!r.ok) { spatialHoverCache.set(featureUrn, null); return null; }
    const ancestors = await r.json();
    if (Array.isArray(ancestors)) {
      // This resolver maps image features to a highlight target only.
      // It must not be coupled to map layer stacking behavior.
      for (const a of ancestors) {
        if (a.urn && layersByEntityUrn.has(a.urn)) {
          spatialHoverCache.set(featureUrn, a.urn);
          return a.urn;
        }
      }
    }
  } catch (_) { /* ignore */ }

  spatialHoverCache.set(featureUrn, null);
  return null;
}

function wireSpatialImageHoverEvents(containerEl) {
  containerEl.querySelectorAll('[data-feature-urn]').forEach(el => {
    const featureUrn = el.dataset.featureUrn;
    let resolvedUrn = null;
    let hoverIntentToken = 0;
    const buildTokenAtBind = imageAssociationBuildToken;

    registerFirstImageAssociation(featureUrn, el);
    void resolveFeatureToLayer(featureUrn).then(layerUrn => {
      if (buildTokenAtBind !== imageAssociationBuildToken) return;
      if (!layerUrn) return;
      registerFirstImageAssociation(layerUrn, el);
    });

    el.addEventListener('mouseenter', e => {
      const shouldPan = shouldPanFromEvent(e);
      const token = ++hoverIntentToken;
      scheduleImageHoverIntent(el, async () => {
        if (token !== hoverIntentToken) return;
        if (!el.matches(':hover')) return;
        beginImageTileHighlight(el);
        resolvedUrn = await resolveFeatureToLayer(featureUrn);
        if (token !== hoverIntentToken) return;
        if (resolvedUrn && el.matches(':hover')) {
          syncOpenImageModalFromElement(el, resolvedUrn);
          paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn: resolvedUrn, shouldPan, source: 'image' });
        }
      });
    });
    el.addEventListener('mouseleave', () => {
      hoverIntentToken += 1;
      cancelImageHoverIntent(el);
      endImageTileHighlight(el);
      if (resolvedUrn) paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: resolvedUrn });
      resolvedUrn = null;
    });
    el.addEventListener('focus', async () => {
      hoverIntentToken += 1;
      cancelImageHoverIntent(el);
      if (shouldSuppressImageFocusHighlight(el)) return;
      beginImageTileHighlight(el);
      const token = hoverIntentToken;
      resolvedUrn = await resolveFeatureToLayer(featureUrn);
      if (token !== hoverIntentToken) return;
      if (resolvedUrn && document.activeElement === el) {
        syncOpenImageModalFromElement(el, resolvedUrn);
        paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn: resolvedUrn, shouldPan: isPanModifierDown(), source: 'image' });
      }
    });
    el.addEventListener('blur', () => {
      hoverIntentToken += 1;
      cancelImageHoverIntent(el);
      endImageTileHighlight(el);
      if (resolvedUrn) paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: resolvedUrn });
      resolvedUrn = null;
    });
  });
}

function renderConceptImages(depictedItems, el) {
  if (!el) return;

  const items = depictedItems || [];
  if (!items.length) {
    el.innerHTML = '<p class="placeholder">No images available.</p>';
    return;
  }

  let html = '<div class="image-grid">';
  for (const item of items) {
    const entityUrn = item.urn || '';
    const imageUrn = item.best_image || entityUrn;
    const url       = item.l_img_url || null;
    const short     = extractShortId(imageUrn || entityUrn);
    const caption   = normalizeImageModalCaption(item.l_description || item.x_luna_description || '');
    const captionAttr = caption ? ` data-image-caption="${escAttr(caption)}"` : '';
    if (url) {
      html += `<a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer" data-image-url="${escAttr(url)}" data-image-urn="${escAttr(imageUrn)}" data-entity-urn="${escAttr(entityUrn)}"${captionAttr}>` +
              `<img src="${escAttr(url)}" alt="${escAttr(short)}" title="${escAttr(short)}" loading="lazy">` +
              `</a>`;
    } else if (entityUrn) {
      html += `<div class="image-urn-fallback" data-image-urn="${escAttr(imageUrn)}" data-entity-urn="${escAttr(entityUrn)}"${captionAttr} title="${escAttr(entityUrn)}">${escHtml(short)}</div>`;
    }
  }
  html += '</div>';
  el.innerHTML = html;
  invalidateImageModalSequence();
  wireImageHoverEvents(el);
  wireImageModalOpenEvents(el);
}

// ── Panel: Map ────────────────────────────────────────────────────────────────

function addGeoJsonLayer(item, styleOpts, clickable) {
  const gj = parseGeoJson(item.geojson);
  if (!gj) return null;

  const layer = L.geoJSON(gj, {
    style: { ...styleOpts, className: clickable ? 'plod-clickable' : 'plod-static' },
    onEachFeature(_feature, lyr) {
      const label = item.label || extractShortId(item.urn || '');
      lyr.bindTooltip(label, { sticky: true });
      if (item.urn) {
        lyr.on('mouseover', () => {
          paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn: item.urn, source: 'map' });
        });
        lyr.on('mouseout', () => {
          paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: item.urn, source: 'map' });
        });
      }
      if (clickable && item.urn) {
        lyr.on('click', () => navigate(item.urn));
      }
    },
  });

  layer.addTo(layerGroup);
  if (item.urn) layersByEntityUrn.set(item.urn, { layer, defaultStyle: { ...styleOpts } });
  return layer;
}

function panToLayerIfOutOfView(layer) {
  if (!leafletMap || !layer || typeof layer.getBounds !== 'function') return;

  let targetBounds = null;
  try {
    targetBounds = layer.getBounds();
  } catch (_) {
    return;
  }

  if (!targetBounds || !targetBounds.isValid()) return;

  const mapBounds = leafletMap.getBounds();
  if (mapBounds.intersects(targetBounds)) return;

  leafletMap.panTo(targetBounds.getCenter(), { animate: true });
}

function isLayerOutOfView(layer) {
  if (!leafletMap || !layer || typeof layer.getBounds !== 'function') return false;

  let targetBounds = null;
  try {
    targetBounds = layer.getBounds();
  } catch (_) {
    return false;
  }

  if (!targetBounds || !targetBounds.isValid()) return false;
  return !leafletMap.getBounds().intersects(targetBounds);
}

function initMapHoverListeners() {
  // Invariant: base spatial layer z-order is immutable after render.
  // Hover/highlight behavior must be style-driven to preserve hit testing.
  paneEvents.on(PANE_EVENT_ENTITY_HIGHLIGHT, ({ urn, shouldPan = false, source = null }) => {
    const entry = layersByEntityUrn.get(urn);
    if (!entry) return;

    currentHoveredEntityUrn = urn;

    if (shouldRunFarZoomAttentionPulse(source)) {
      runFarZoomAttentionPulse(urn, entry);
    } else {
      cancelAttentionPulseForUrn(urn);
      entry.layer.setStyle(HIGHLIGHT_STYLE);
    }

    const outOfView = isLayerOutOfView(entry.layer);
    if (source === 'image' && outOfView && !shouldPan && !isPanModifierDown()) {
      showMapFocusHint();
    }

    if (shouldPan || isPanModifierDown()) {
      panToLayerIfOutOfView(entry.layer);
    }

    hideActiveAncestorOutline();
    if (currentResourceProfile !== 'concept') return;

    void showAncestorOutlineForHoveredEntity(urn);
  });
  paneEvents.on(PANE_EVENT_ENTITY_CLEAR, ({ urn }) => {
    const entry = layersByEntityUrn.get(urn);
    if (!entry) return;

    cancelAttentionPulseForUrn(urn);
    if (currentHoveredEntityUrn === urn) currentHoveredEntityUrn = null;
    hideActiveAncestorOutline();
    entry.layer.setStyle(entry.defaultStyle);
  });

  paneEvents.on(PANE_EVENT_ENTITY_HIGHLIGHT, ({ urn, source }) => {
    if (source !== 'map') return;
    if (suppressMapToImageHighlight) return;
    const imageEl = highlightAndScrollToFirstAssociatedImage(urn);
    if (!imageEl) return;
    syncOpenImageModalFromEntityUrn(urn);
  });

  paneEvents.on(PANE_EVENT_ENTITY_CLEAR, ({ source }) => {
    if (source !== 'map') return;
    clearActiveMapHoverImage();
  });
}

function renderMap(selfItem, childItems, isSpatial, conceptDetailLevel, slotEl, labelEl) {
  ensureMapInitialized(slotEl);
  initMapUrlSync();
  if (!leafletMap || !layerGroup) return;

  clearMapLayers();

  const bounds = [];

  const selfStyle = { color: '#777', weight: 1.5, fillOpacity: 0.02, fillColor: '#777' };
  const mainLayerStyle = {
    color: '#d60000',
    weight: 3,
    fillColor: '#ff1f1f',
    fillOpacity: 0.16,
  };

  if (selfItem) {
    const layer = addGeoJsonLayer(selfItem, selfStyle, false);
    if (layer) {
      try { const b = layer.getBounds(); if (b.isValid()) bounds.push(b); } catch (_) {}
    }
  }

  for (const item of (childItems || [])) {
    const layer = addGeoJsonLayer(item, mainLayerStyle, true);
    if (layer) {
      try { const b = layer.getBounds(); if (b.isValid()) bounds.push(b); } catch (_) {}
    }
  }

  if (bounds.length) {
    let combined = bounds[0];
    for (let i = 1; i < bounds.length; i++) combined = combined.extend(bounds[i]);
    leafletMap.fitBounds(combined, { padding: [24, 24] });
  }

  applyPendingMapViewOverride();
  updateUrlWithRatios();

  if (labelEl) {
    labelEl.textContent =
      isSpatial
        ? 'Map — spatial context'
        : conceptDetailLevel === 'space'
          ? 'Map — depicted in (space)'
          : 'Map — depicted in (feature fallback)';
  }
}

async function fetchDepictedWhereByDetail(shortId, detailLevel) {
  try {
    const r = await fetch(
      `${API_BASE}/depicted-where/${encodeURIComponent(shortId)}?level_of_detail=${encodeURIComponent(detailLevel)}`
    );
    if (!r.ok) return null;
    const payload = await r.json();
    return Array.isArray(payload) ? payload : [];
  } catch (_) {
    return null;
  }
}

async function fetchDepictedWhereWithSpaceFallback(shortId) {
  const spaceItems = await fetchDepictedWhereByDetail(shortId, 'space');
  if (Array.isArray(spaceItems) && spaceItems.length > 0) {
    return { detailLevel: 'space', items: spaceItems };
  }

  const featureItems = await fetchDepictedWhereByDetail(shortId, 'feature');
  return {
    detailLevel: 'feature',
    items: Array.isArray(featureItems) ? featureItems : [],
  };
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(id) {
  location.hash = buildHash(id, currentPaneLayoutOverride);
}

async function loadEntity(rawId) {
  paneEvents.emit(UI_EVENT_IMAGE_MODAL_CLOSE);

  const id      = normalizeId(rawId);
  const shortId = extractShortId(id);

  document.getElementById('current-id').textContent = id;
  document.getElementById('id-input').value = shortId;

  const provisionalLayout = normalizePaneLayout(currentPaneLayoutOverride || currentPaneLayout, DEFAULT_PANE_LAYOUT);
  applyPaneLayout(provisionalLayout);
  clearHierarchyState();
  clearMapLayers();
  clearImageAssociations();

  renderLoadingInSlot(getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.INFO));
  renderLoadingInSlot(getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.IMAGES));
  renderHierarchyPlaceholder(
    getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER),
    currentResourceProfile
  );

  // Step 1: fetch metadata (we need the type to decide the map mode)
  let triples = {};
  try {
    const r = await fetch(`${API_BASE}/id/${encodeURIComponent(shortId)}`);
    if (r.ok) triples = flattenTriples(await r.json());
  } catch (_) { /* ignore */ }

  const typeUrn   = (triples['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'] || [])[0] || '';
  const label     = (triples['http://www.w3.org/2000/01/rdf-schema#label'] || [])[0] || shortId;
  const isSpatial = SPATIAL_TYPES.has(typeUrn);
  const selfGjStr = (triples['urn:p-lod:id:geojson'] || [])[0] || null;

  const resolved = resolvePaneLayout(typeUrn, currentPaneLayoutOverride);
  currentResourceProfile = resolved.profile;
  applyPaneLayout(resolved.layout);

  renderInfo(triples, getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.INFO));
  renderHierarchyPlaceholder(
    getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER),
    currentResourceProfile
  );

  const hierarchyProfile = currentResourceProfile === 'concept' || currentResourceProfile === 'spatial'
    ? currentResourceProfile
    : null;
  const currentHierarchyNode = {
    urn: id,
    label,
    type: extractShortId(typeUrn),
    geojson: selfGjStr,
  };

  // Step 2: parallel fetches — images (spatial only) + map/concept children + hierarchy
  const [imagesRes, mapRes, hierarchyRes] = await Promise.allSettled([
    isSpatial
      ? fetch(`${API_BASE}/images/${encodeURIComponent(shortId)}`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      : Promise.resolve(null),
    isSpatial
      ? fetch(`${API_BASE}/spatial-children/${encodeURIComponent(shortId)}`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      : fetchDepictedWhereWithSpaceFallback(shortId),
    hierarchyProfile
      ? buildHierarchyState(hierarchyProfile, currentHierarchyNode)
      : Promise.resolve(null),
  ]);

  let childItems = [];
  let conceptDetailLevel = 'feature';
  if (mapRes.status === 'fulfilled') {
    if (isSpatial) {
      childItems = mapRes.value || [];
    } else {
      childItems = (mapRes.value && mapRes.value.items) || [];
      conceptDetailLevel = (mapRes.value && mapRes.value.detailLevel) || 'feature';
    }
  }

  if (isSpatial) {
    renderImages(
      imagesRes.status === 'fulfilled' ? imagesRes.value : [],
      getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.IMAGES)
    );
  } else {
    renderConceptImages(
      childItems,
      getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.IMAGES)
    );
  }

  hierarchyState = hierarchyRes.status === 'fulfilled' ? hierarchyRes.value : null;
  rerenderHierarchy();

  // Build the self-boundary item for spatial entities
  let selfItem = null;
  if (isSpatial) {
    let gjStr = selfGjStr;
    if (!gjStr) {
      // Fallback: try the dedicated /geojson/ endpoint
      try {
        const r = await fetch(`${API_BASE}/geojson/${encodeURIComponent(shortId)}`);
        if (r.ok) gjStr = JSON.stringify(await r.json());
      } catch (_) { /* ignore */ }
    }
    if (gjStr && gjStr !== 'None') {
      selfItem = { urn: id, label: shortId, geojson: gjStr };
    }
  }

  const mapPosition = getPanePositionForContent(currentPaneLayout, PANE_CONTENT_TYPES.MAP);
  const mapPaneEls = mapPosition ? getPaneElements(mapPosition) : null;
  renderMap(
    selfItem,
    childItems,
    isSpatial,
    conceptDetailLevel,
    mapPaneEls ? mapPaneEls.slot : null,
    mapPaneEls ? mapPaneEls.label : null
  );
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function handleRouteChange() {
  const hashState = parseHashState();
  currentPaneLayoutOverride = hashState.layoutOverride;
  pendingMapViewOverride = hashState.mapView;

  applyRatiosFromHashState(hashState);
  applyGridRatios();

  const targetId = hashState.id || DEFAULT_ID;
  loadEntity(targetId);
}

window.addEventListener('hashchange', handleRouteChange);

document.addEventListener('DOMContentLoaded', () => {
  syncHighlightCssVars();
  initModifierKeyTracking();
  initImageModalEvents();

  const initialHashState = parseHashState();
  currentPaneLayoutOverride = initialHashState.layoutOverride;
  applyRatiosFromHashState(initialHashState);
  applyGridRatios();
  initDividerDrag();

  applyPaneLayout(currentPaneLayoutOverride || DEFAULT_PANE_LAYOUT);
  initMapHoverListeners();

  // Header controls
  const input = document.getElementById('id-input');
  const datalist = document.getElementById('id-suggestions');
  const goBtn = document.getElementById('go-btn');

  const updateTypeahead = debounce(async () => {
    await ensureTypeaheadLoaded();
    renderTypeaheadSuggestions(input.value, datalist);
  }, TYPEAHEAD_DEBOUNCE_MS);

  input.addEventListener('focus', () => {
    ensureTypeaheadLoaded()
      .then(() => renderTypeaheadSuggestions(input.value, datalist))
      .catch(() => {});
  });

  input.addEventListener('input', evt => {
    updateTypeahead();

    // Selecting a datalist option emits replacement text input.
    if (isTypeaheadSelectionEvent(evt)) {
      navigate(resolveSearchInputToId(input.value || DEFAULT_ID));
    }
  });

  goBtn.addEventListener('click', () => {
    navigate(resolveSearchInputToId(input.value || DEFAULT_ID));
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      navigate(resolveSearchInputToId(input.value || DEFAULT_ID));
    }
  });

  // Warm the type-ahead cache in the background.
  ensureTypeaheadLoaded().catch(() => {});

  handleRouteChange();
});
