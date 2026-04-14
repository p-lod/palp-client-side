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

function renderMap(selfItem, childItems, isSpatial) {
  layerGroup.clearLayers();

  const bounds = [];

  const selfStyle     = { color: '#555',    weight: 2,   fillOpacity: 0.04, fillColor: '#888'    };
  const spatialStyle  = { color: '#5b7fa6', weight: 1.5, fillOpacity: 0.22, fillColor: '#5b7fa6' };
  const depictedStyle = { color: '#a67c5b', weight: 1.5, fillOpacity: 0.22, fillColor: '#a67c5b' };

  if (selfItem) {
    const layer = addGeoJsonLayer(selfItem, selfStyle, false);
    if (layer) {
      try { const b = layer.getBounds(); if (b.isValid()) bounds.push(b); } catch (_) {}
    }
  }

  for (const item of (childItems || [])) {
    const style = isSpatial ? spatialStyle : depictedStyle;
    const layer = addGeoJsonLayer(item, style, true);
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
    isSpatial ? 'Map — spatial context' : 'Map — depicted in';
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(id) {
  location.hash = encodeURIComponent(normalizeId(id));
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
  const mapEndpoint = isSpatial
    ? `${API_BASE}/spatial-children/${encodeURIComponent(shortId)}`
    : `${API_BASE}/depicted-where/${encodeURIComponent(shortId)}`;

  const [imagesRes, mapRes] = await Promise.allSettled([
    fetch(`${API_BASE}/images/${encodeURIComponent(shortId)}`)
      .then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(mapEndpoint)
      .then(r => r.ok ? r.json() : []).catch(() => []),
  ]);

  renderImages(imagesRes.status === 'fulfilled' ? imagesRes.value : []);

  const childItems = mapRes.status === 'fulfilled' ? (mapRes.value || []) : [];

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

  renderMap(selfItem, childItems, isSpatial);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('hashchange', () => {
  const decoded = decodeURIComponent(location.hash.slice(1));
  if (decoded) loadEntity(decoded);
});

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Leaflet (DOM is ready here)
  leafletMap = L.map('map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(leafletMap);
  layerGroup = L.layerGroup().addTo(leafletMap);
  leafletMap.setView([40.7506, 14.4890], 15);

  // Header controls
  const input = document.getElementById('id-input');
  const goBtn = document.getElementById('go-btn');

  goBtn.addEventListener('click', () => navigate(input.value || DEFAULT_ID));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') navigate(input.value || DEFAULT_ID);
  });

  // Load initial entity from hash or default
  const initial = decodeURIComponent(location.hash.slice(1));
  loadEntity(initial || DEFAULT_ID);
});
