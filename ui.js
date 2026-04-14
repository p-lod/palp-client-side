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

// ── Panel divider: persist col/row split ratios in URL ────────────────────────

const MIN_PANE_RATIO = 0.2;  // 20% minimum for any column/row
const MAX_PANE_RATIO = 0.8;  // 80% maximum

let currentColSplit = 0.5;  // left column width ratio
let currentRowSplit = 0.5;  // top row height ratio

function parseGridRatios() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const col = parseFloat(params.get('col-split'));
  const row = parseFloat(params.get('row-split'));
  if (!isNaN(col) && col > 0 && col < 1) currentColSplit = col;
  if (!isNaN(row) && row > 0 && row < 1) currentRowSplit = row;
}

function applyGridRatios() {
  const grid = document.getElementById('grid');
  const divider = document.getElementById('grid-divider');
  grid.style.gridTemplateColumns = `${currentColSplit}fr ${1 - currentColSplit}fr`;
  grid.style.gridTemplateRows = `${currentRowSplit}fr ${1 - currentRowSplit}fr`;
  divider.style.left = `${currentColSplit * 100}%`;
  divider.style.top = `${currentRowSplit * 100}%`;
}

function updateUrlWithRatios() {
  const hash = location.hash.split('?')[0].slice(1);
  const params = new URLSearchParams();
  params.set('col-split', currentColSplit.toFixed(3));
  params.set('row-split', currentRowSplit.toFixed(3));
  const newHash = `#${hash}?${params.toString()}`;
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

// ── Panel: Info ───────────────────────────────────────────────────────────────

function renderInfo(triples) {
  const el = document.getElementById('info-content');

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
        return `<a href="#" data-navigate="${escAttr(v)}">${escHtml(extractShortId(v))}</a>`;
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

function renderImages(images) {
  const el = document.getElementById('images-content');

  if (!images || !images.length) {
    el.innerHTML = '<p class="placeholder">No images available.</p>';
    return;
  }

  el.innerHTML = '<p class="loading">Loading images…</p>';

  Promise.all(images.slice(0, 12).map(resolveImageUrl)).then(results => {
    const valid = results.filter(Boolean);
    if (!valid.length) {
      el.innerHTML = '<p class="placeholder">No images available.</p>';
      return;
    }

    let html = '<div class="image-grid">';
    for (const { urn, url } of valid) {
      const short = extractShortId(urn);
      if (url) {
        html += `<a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">` +
                `<img src="${escAttr(url)}" alt="${escAttr(short)}" title="${escAttr(short)}" loading="lazy">` +
                `</a>`;
      } else {
        html += `<div class="image-urn-fallback" title="${escAttr(urn)}">${escHtml(short)}</div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
  });
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
  return layer;
}

function renderMap(selfItem, childItems, isSpatial, conceptDetailLevel = 'feature') {
  layerGroup.clearLayers();

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

  document.getElementById('map-label').textContent =
    isSpatial
      ? 'Map — spatial context'
      : conceptDetailLevel === 'space'
        ? 'Map — depicted in (space)'
        : 'Map — depicted in (feature fallback)';
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
  const normalId = normalizeId(id);
  const params = new URLSearchParams();
  params.set('col-split', currentColSplit.toFixed(3));
  params.set('row-split', currentRowSplit.toFixed(3));
  location.hash = `${encodeURIComponent(normalId)}?${params.toString()}`;
}

async function loadEntity(rawId) {
  const id      = normalizeId(rawId);
  const shortId = extractShortId(id);

  document.getElementById('current-id').textContent   = id;
  document.getElementById('id-input').value           = shortId;
  document.getElementById('info-content').innerHTML   = '<p class="loading">Loading…</p>';
  document.getElementById('images-content').innerHTML = '<p class="loading">Loading…</p>';
  layerGroup.clearLayers();

  // Step 1: fetch metadata (we need the type to decide the map mode)
  let triples = {};
  try {
    const r = await fetch(`${API_BASE}/id/${encodeURIComponent(shortId)}`);
    if (r.ok) triples = flattenTriples(await r.json());
  } catch (_) { /* ignore */ }

  renderInfo(triples);

  const typeUrn   = (triples['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'] || [])[0] || '';
  const isSpatial = SPATIAL_TYPES.has(typeUrn);
  const selfGjStr = (triples['urn:p-lod:id:geojson'] || [])[0] || null;

  // Step 2: parallel fetches — images + map children
  const [imagesRes, mapRes] = await Promise.allSettled([
    fetch(`${API_BASE}/images/${encodeURIComponent(shortId)}`)
      .then(r => r.ok ? r.json() : []).catch(() => []),
    isSpatial
      ? fetch(`${API_BASE}/spatial-children/${encodeURIComponent(shortId)}`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      : fetchDepictedWhereWithSpaceFallback(shortId),
  ]);

  renderImages(imagesRes.status === 'fulfilled' ? imagesRes.value : []);

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

  renderMap(selfItem, childItems, isSpatial, conceptDetailLevel);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  const [encodedId, queryStr] = hash.split('?');
  const decoded = decodeURIComponent(encodedId);
  
  // Parse and apply grid ratios if present
  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    const col = parseFloat(params.get('col-split'));
    const row = parseFloat(params.get('row-split'));
    if (!isNaN(col) && col > 0 && col < 1) currentColSplit = col;
    if (!isNaN(row) && row > 0 && row < 1) currentRowSplit = row;
    applyGridRatios();
  }
  
  if (decoded) loadEntity(decoded);
});

document.addEventListener('DOMContentLoaded', () => {
  // Parse and apply grid ratios from URL
  parseGridRatios();
  applyGridRatios();
  initDividerDrag();

  // Initialize Leaflet (DOM is ready here)
  leafletMap = L.map('map', { zoomControl: true });
  L.tileLayer('http://palp.art/xyz-tiles/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(leafletMap);
  layerGroup = L.layerGroup().addTo(leafletMap);
  leafletMap.setView([40.7506, 14.4890], 15);

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

  input.addEventListener('input', () => {
    updateTypeahead();
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

  // Load initial entity from hash or default
  const hash = location.hash.slice(1);
  if (hash) {
    const [encodedId, queryStr] = hash.split('?');
    const initial = decodeURIComponent(encodedId);
    loadEntity(initial || DEFAULT_ID);
  } else {
    loadEntity(DEFAULT_ID);
  }
});
