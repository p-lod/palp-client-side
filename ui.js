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
  'urn:p-lod:id:vicolo',
  'urn:p-lod:id:garden',
  'urn:p-lod:id:room',
  'urn:p-lod:id:space',
  'urn:p-lod:id:structure',
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
const TYPEAHEAD_MAX_SUGGESTIONS = 16;
const TYPEAHEAD_DEBOUNCE_MS = 120;
const TYPEAHEAD_CACHE_MS = 5 * 60 * 1000;

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

const PANE_EVENT_SPACE_HOVER   = 'space:hover';
const PANE_EVENT_SPACE_UNHOVER = 'space:unhover';

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

let currentColSplit = 0.5;  // left column width ratio
let currentRowSplit = 0.5;  // top row height ratio

function parseHashState() {
  const rawHash = location.hash.slice(1);
  const [encodedId, queryStr] = rawHash.split('?');
  const id = encodedId ? decodeURIComponent(encodedId) : '';

  const params = new URLSearchParams(queryStr || '');
  const col = parseFloat(params.get('col-split'));
  const row = parseFloat(params.get('row-split'));
  const layoutOverride = parsePaneLayout(params.get('layout'));

  return {
    id,
    colSplit: !isNaN(col) && col > 0 && col < 1 ? col : null,
    rowSplit: !isNaN(row) && row > 0 && row < 1 ? row : null,
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
  params.set('col-split', currentColSplit.toFixed(3));
  params.set('row-split', currentRowSplit.toFixed(3));
  if (layoutOverride) params.set('layout', encodePaneLayout(layoutOverride));
  return `#${encodeURIComponent(shortId)}?${params.toString()}`;
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
let layersBySpaceUrn = new Map();   // URN → { layer, defaultStyle } for hover linkage
let spatialHoverCache = new Map();  // featureUrn → resolved layerUrn|null, cleared on navigation

const HIGHLIGHT_STYLE = Object.freeze({
  color: '#ff9900',
  weight: 4,
  fillColor: '#ffcc00',
  fillOpacity: 0.5,
});

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

  if (!leafletMap) {
    leafletMap = L.map(container, { zoomControl: true });
    L.tileLayer('http://palp.art/xyz-tiles/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(leafletMap);
    layerGroup = L.layerGroup().addTo(leafletMap);
    leafletMap.setView([40.7506, 14.4890], 15);
  } else {
    leafletMap.invalidateSize();
  }
}

function clearMapLayers() {
  if (layerGroup) layerGroup.clearLayers();
  layersBySpaceUrn.clear();
  spatialHoverCache.clear();
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
  for (const img of images.slice(0, 100)) {
    if (img && img.urn && img.feature) featureByUrn.set(img.urn, img.feature);
  }

  Promise.all(images.slice(0, 100).map(resolveImageUrl)).then(results => {
    const valid = results.filter(Boolean);
    if (!valid.length) {
      el.innerHTML = '<p class="placeholder">No images available.</p>';
      return;
    }

    let html = '<div class="image-grid">';
    for (const { urn, url } of valid) {
      const short = extractShortId(urn);
      const featureUrn = featureByUrn.get(urn) || '';
      const featureAttr = featureUrn ? ` data-feature-urn="${escAttr(featureUrn)}"` : '';
      if (url) {
        html += `<a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer"${featureAttr}>` +
                `<img src="${escAttr(url)}" alt="${escAttr(short)}" title="${escAttr(short)}" loading="lazy">` +
                `</a>`;
      } else {
        html += `<div class="image-urn-fallback"${featureAttr} title="${escAttr(urn)}">${escHtml(short)}</div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
    wireSpatialImageHoverEvents(el);
  });
}

function wireImageHoverEvents(containerEl) {
  containerEl.querySelectorAll('[data-space-urn]').forEach(el => {
    const urn = el.dataset.spaceUrn;
    el.addEventListener('mouseenter', () => paneEvents.emit(PANE_EVENT_SPACE_HOVER,   { urn }));
    el.addEventListener('mouseleave', () => paneEvents.emit(PANE_EVENT_SPACE_UNHOVER, { urn }));
  });
}

async function resolveFeatureToLayer(featureUrn) {
  if (spatialHoverCache.has(featureUrn)) return spatialHoverCache.get(featureUrn);

  // Direct match (edge case: feature URN is itself a registered layer)
  if (layersBySpaceUrn.has(featureUrn)) {
    spatialHoverCache.set(featureUrn, featureUrn);
    return featureUrn;
  }

  try {
    const shortId = extractShortId(featureUrn);
    const r = await fetch(`${API_BASE}/spatial-ancestors/${encodeURIComponent(shortId)}`);
    if (!r.ok) { spatialHoverCache.set(featureUrn, null); return null; }
    const ancestors = await r.json();
    if (Array.isArray(ancestors)) {
      for (const a of ancestors) {
        if (a.urn && layersBySpaceUrn.has(a.urn)) {
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
    el.addEventListener('mouseenter', async () => {
      resolvedUrn = await resolveFeatureToLayer(featureUrn);
      if (resolvedUrn && el.matches(':hover')) {
        paneEvents.emit(PANE_EVENT_SPACE_HOVER, { urn: resolvedUrn });
      }
    });
    el.addEventListener('mouseleave', () => {
      if (resolvedUrn) paneEvents.emit(PANE_EVENT_SPACE_UNHOVER, { urn: resolvedUrn });
    });
  });
}

function renderConceptImages(depictedItems, el) {
  if (!el) return;

  const items = (depictedItems || []).slice(0, 100);
  if (!items.length) {
    el.innerHTML = '<p class="placeholder">No images available.</p>';
    return;
  }

  let html = '<div class="image-grid">';
  for (const item of items) {
    const spaceUrn = item.urn || '';
    const url      = item.l_img_url || null;
    const short    = extractShortId(spaceUrn);
    if (url) {
      html += `<a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer" data-space-urn="${escAttr(spaceUrn)}">` +
              `<img src="${escAttr(url)}" alt="${escAttr(short)}" title="${escAttr(short)}" loading="lazy">` +
              `</a>`;
    } else if (spaceUrn) {
      html += `<div class="image-urn-fallback" data-space-urn="${escAttr(spaceUrn)}" title="${escAttr(spaceUrn)}">${escHtml(short)}</div>`;
    }
  }
  html += '</div>';
  el.innerHTML = html;
  wireImageHoverEvents(el);
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
      if (clickable && item.urn) {
        lyr.on('click', () => navigate(item.urn));
      }
    },
  });

  layer.addTo(layerGroup);
  if (item.urn) layersBySpaceUrn.set(item.urn, { layer, defaultStyle: { ...styleOpts } });
  return layer;
}

function initMapHoverListeners() {
  paneEvents.on(PANE_EVENT_SPACE_HOVER, ({ urn }) => {
    const entry = layersBySpaceUrn.get(urn);
    if (!entry) return;
    entry.layer.setStyle(HIGHLIGHT_STYLE);
    entry.layer.bringToFront();
  });
  paneEvents.on(PANE_EVENT_SPACE_UNHOVER, ({ urn }) => {
    const entry = layersBySpaceUrn.get(urn);
    if (!entry) return;
    entry.layer.setStyle(entry.defaultStyle);
  });
}

function renderMap(selfItem, childItems, isSpatial, conceptDetailLevel, slotEl, labelEl) {
  ensureMapInitialized(slotEl);
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
  const id      = normalizeId(rawId);
  const shortId = extractShortId(id);

  document.getElementById('current-id').textContent = id;
  document.getElementById('id-input').value = shortId;

  const provisionalLayout = normalizePaneLayout(currentPaneLayoutOverride || currentPaneLayout, DEFAULT_PANE_LAYOUT);
  applyPaneLayout(provisionalLayout);
  clearMapLayers();

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

  // Step 2: parallel fetches — images (spatial only) + map/concept children
  const [imagesRes, mapRes] = await Promise.allSettled([
    isSpatial
      ? fetch(`${API_BASE}/images/${encodeURIComponent(shortId)}`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      : Promise.resolve(null),
    isSpatial
      ? fetch(`${API_BASE}/spatial-children/${encodeURIComponent(shortId)}`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      : fetchDepictedWhereWithSpaceFallback(shortId),
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

  applyRatiosFromHashState(hashState);
  applyGridRatios();

  const targetId = hashState.id || DEFAULT_ID;
  loadEntity(targetId);
}

window.addEventListener('hashchange', handleRouteChange);

document.addEventListener('DOMContentLoaded', () => {
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
