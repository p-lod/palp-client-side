'use strict';

const API_BASE   = 'https://api.p-lod.org';
const DEFAULT_ID = 'urn:p-lod:id:pompeii';
const POMPEIAN_WALL_PAINTING_STYLE_TYPE = 'urn:p-lod:id:pompeian-wall-painting-style';
const SPACE_CHARACTERIZATION_TYPE = 'urn:p-lod:id:space-characterization';

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
  'urn:p-lod:id:has-pompeian-wall-painting-style': 'Wall-painting Style',
  'urn:p-lod:id:has-space-characterization': "Space characterization",
};

// Predicates omitted from the info table (handled separately or not display-useful)
const SKIP_PREDICATES = new Set([
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2000/01/rdf-schema#isDefinedBy',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  'urn:p-lod:id:broader' ,
  'urn:p-lod:id:spatially-within' ,
  'urn:p-lod:id:geojson',
  'urn:p-lod:id:best-image',
  'urn:p-lod:id:sort-order-label',
  'urn:p-lod:id:x-source',
  'urn:p-lod:id:identifier',
  'urn:p-lod:id:arcgis-id',
  'urn:p-lod:id:surface-area'
]);

const EXTERNAL_LINK_PREDICATE_META = Object.freeze({
  'urn:p-lod:id:pleiades-url': { icon: 'PL', label: 'Pleiades' },
  'urn:p-lod:id:wikidata-url': { icon: 'WD', label: 'Wikidata' },
  'urn:p-lod:id:wiki-en-url': { icon: 'WEN', label: 'Wikipedia (EN)' },
  'urn:p-lod:id:en-wiki-url': { icon: 'WEN', label: 'Wikipedia (EN)' },
  'urn:p-lod:id:wiki-it-url': { icon: 'WIT', label: 'Wikipedia (IT)' },
  'urn:p-lod:id:p-in-p-url': { icon: 'PIP', label: 'Pompeii in Pictures' },
  'urn:p-lod:id:manto-url': { icon: 'MANTO', label: 'Manto' },
  'urn:p-lod:id:getty-lod-url': { icon: 'GL', label: 'Getty LOD' },
});

const DEFAULT_EXTERNAL_LINK_ICON = 'EXT';

const TYPEAHEAD_SOURCE_TYPES = ['concept', 'region', 'insula', 'property'];
const TYPEAHEAD_SHOW_ID_TYPES = new Set(['region', 'insula', 'property']);
const TYPEAHEAD_MAX_SUGGESTIONS = 64;
const TYPEAHEAD_DEBOUNCE_MS = 120;
const TYPEAHEAD_CACHE_MS = 5 * 60 * 1000;
const IMAGE_HOVER_INTENT_DELAY_MS = 180;
const INFO_CHIP_PREVIEW_CLEAR_DELAY_MS = 320;
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
const PANE_EVENT_IMAGE_PREVIEW_REQUEST = 'images:preview-request';
const PANE_EVENT_IMAGE_PREVIEW_CLEAR   = 'images:preview-clear';
const UI_EVENT_IMAGE_MODAL_OPEN   = 'image-modal:open';
const UI_EVENT_IMAGE_MODAL_CLOSE  = 'image-modal:close';

const IMAGE_PANE_BEHAVIOR = Object.freeze({
  SPATIAL_PRELOAD: 'spatial-preload',
  CONCEPT_PRELOAD: 'concept-preload',
  FEATURE_HOVER_PREVIEW: 'feature-hover-preview',
});

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

function getPredicateTail(uri) {
  const m = String(uri).match(/[#/]([^#/]+)$/);
  return m ? m[1] : String(uri);
}

function isExternalLinkPredicate(predicate) {
  if (EXTERNAL_LINK_PREDICATE_META[predicate]) return true;
  return /(?:-|_)url$/i.test(getPredicateTail(predicate));
}

function getExternalLinkMeta(predicate) {
  const explicit = EXTERNAL_LINK_PREDICATE_META[predicate];
  if (explicit) return explicit;
  return {
    icon: DEFAULT_EXTERNAL_LINK_ICON,
    label: humanizePredicate(predicate),
  };
}

function collectExternalLinks(triples) {
  const links = [];
  const seen = new Set();

  for (const [predicate, vals] of Object.entries(triples || {})) {
    if (!isExternalLinkPredicate(predicate)) continue;
    for (const val of vals || []) {
      if (!isHttpUrl(val)) continue;
      const url = String(val);
      const dedupeKey = `${predicate}::${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const meta = getExternalLinkMeta(predicate);
      links.push({
        predicate,
        url,
        icon: meta.icon,
        label: meta.label,
        title: `${meta.label}: ${url}`,
      });
    }
  }

  return links;
}

function isDisplayLabelUsable(label) {
  const text = String(label || '').trim();
  return !!text && text.toLowerCase() !== 'none';
}

function getDisplayLabelOrFallback(label, fallback = '') {
  return isDisplayLabelUsable(label)
    ? String(label).trim()
    : String(fallback || '').trim();
}

function normalizeRelatedEntityItem(item) {
  if (!item || !item.urn) return null;

  const urn = String(item.urn);
  const fallbackLabel = extractShortId(urn);
  const label = getDisplayLabelOrFallback(item.label, fallbackLabel);

  const within = String(item.within || '').startsWith('urn:p-lod:id:')
    ? extractShortId(item.within)
    : '';

  return {
    urn,
    label,
    shortId: fallbackLabel,
    within,
  };
}

function normalizeUniqueRelatedEntityItems(items) {
  const normalized = [];
  const seen = new Set();

  for (const item of items || []) {
    const entry = normalizeRelatedEntityItem(item);
    if (!entry || seen.has(entry.urn)) continue;
    seen.add(entry.urn);
    normalized.push(entry);
  }

  return normalized;
}

function renderActionableInfoEntityRow(config) {
  const {
    rowClass,
    labelClass,
    listClass,
    itemClass,
    sectionLabel,
    dataUrnAttribute,
    items,
    enablePin = false,
    pinContextClass = 'map-pin-toggle-info',
  } = config;

  if (!items.length) return '';

  const chips = items.map(item => {
    const titleBits = [item.label, item.shortId];
    if (item.within) titleBits.push(`within ${item.within}`);
    const title = `${sectionLabel}: ${titleBits.join(' • ')}`;
    const pinButtonHtml = enablePin
      ? renderMapPinToggleButton({
          urn: item.urn,
          shortLabel: item.shortId,
          contextClass: pinContextClass,
          hoverUrnAttribute: dataUrnAttribute,
        })
      : '';
    const chipShellClass = `info-entity-chip-shell${pinButtonHtml ? ' has-pin-toggle' : ''}`;

    return (
      `<span class="${chipShellClass}">` +
      `<button type="button" class="${itemClass}" data-navigate="${escAttr(item.shortId)}" ${dataUrnAttribute}="${escAttr(item.urn)}" title="${escAttr(title)}" aria-label="${escAttr(item.label)}">` +
      `<span class="info-action-chip-label">${escHtml(item.label)}</span>` +
      '</button>' +
      pinButtonHtml +
      '</span>'
    );
  }).join('');

  return (
    `<div class="${rowClass}">` +
      `<span class="${labelClass}">${escHtml(sectionLabel)}</span>` +
      `<span class="${listClass}">${chips}</span>` +
    '</div>'
  );
}

function renderMapPinToggleButton({ urn, shortLabel = '', contextClass = '', hoverUrnAttribute = '' } = {}) {
  if (!urn) return '';

  const shortText = String(shortLabel || extractShortId(urn) || '').trim();
  const safeLabel = shortText || 'item';
  const label = `Pin ${safeLabel} geometry on map`;
  const classSuffix = contextClass ? ` ${contextClass}` : '';
  const hoverAttr = hoverUrnAttribute ? ` ${hoverUrnAttribute}="${escAttr(urn)}"` : '';

  return (
    `<button type="button" class="map-pin-toggle${classSuffix}" data-map-pin-urn="${escAttr(urn)}" data-map-pin-label="${escAttr(safeLabel)}"${hoverAttr} aria-pressed="false" aria-label="${escAttr(label)}" title="${escAttr(label)}">` +
      '<span class="map-pin-toggle-icon" aria-hidden="true"></span>' +
    '</button>'
  );
}

function syncMapPinToggleButtonState(button, isPinned) {
  if (!button) return;

  const pinLabel = String(button.dataset.mapPinLabel || 'item').trim() || 'item';
  const label = isPinned
    ? `Unpin ${pinLabel} geometry from map`
    : `Pin ${pinLabel} geometry on map`;

  button.classList.toggle('is-pinned', !!isPinned);
  button.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);

  const infoChipShell = button.closest('.info-entity-chip-shell.has-pin-toggle');
  if (infoChipShell) infoChipShell.classList.toggle('is-pinned', !!isPinned);
}

function refreshMapPinToggleButtons(targetUrn = '') {
  const shouldFilter = !!targetUrn;

  document.querySelectorAll('[data-map-pin-urn]').forEach(button => {
    const urn = button.dataset.mapPinUrn;
    if (!urn) return;
    if (shouldFilter && urn !== targetUrn) return;

    syncMapPinToggleButtonState(button, isMapGeojsonPinned(urn));
  });
}

function bindMapPinToggleButtons(containerEl = document) {
  if (!containerEl) return;

  containerEl.querySelectorAll('[data-map-pin-urn]').forEach(button => {
    if (button.dataset.mapPinBound === '1') {
      syncMapPinToggleButtonState(button, isMapGeojsonPinned(button.dataset.mapPinUrn));
      return;
    }

    button.dataset.mapPinBound = '1';
    syncMapPinToggleButtonState(button, isMapGeojsonPinned(button.dataset.mapPinUrn));

    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();

      const urn = button.dataset.mapPinUrn;
      if (!urn) return;
      void toggleMapGeojsonPin(urn);
    });
  });
}

function renderInfoEntityRowLoading(config) {
  const {
    rowClass,
    labelClass,
    listClass,
    sectionLabel,
  } = config;

  return (
    `<div class="${rowClass}">` +
      `<span class="${labelClass}">${escHtml(sectionLabel)}</span>` +
      `<span class="${listClass}"><span class="info-chip-section-loading loading" aria-live="polite">Loading...</span></span>` +
    '</div>'
  );
}

const externalLinkPreviewState = {
  isOpen: false,
  eventsBound: false,
  overlayEl: null,
  dialogEl: null,
  titleEl: null,
  launchLinkEl: null,
  iframeEl: null,
  closeBtnEl: null,
};

function ensureExternalLinkPreviewInitialized() {
  if (externalLinkPreviewState.overlayEl && document.body.contains(externalLinkPreviewState.overlayEl)) {
    return;
  }

  const overlayEl = document.createElement('div');
  overlayEl.className = 'external-link-modal-overlay';
  overlayEl.hidden = true;
  overlayEl.innerHTML =
    '<div class="external-link-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="external-link-modal-title">' +
      '<div class="external-link-modal-header">' +
        '<div class="external-link-modal-title" id="external-link-modal-title">Link preview</div>' +
        '<div class="external-link-modal-actions">' +
          '<a class="external-link-modal-launch" href="#" target="_blank" rel="noopener noreferrer">Go to page</a>' +
          '<button type="button" class="external-link-modal-close" aria-label="Close preview" title="Close preview">×</button>' +
        '</div>' +
      '</div>' +
      '<iframe class="external-link-modal-iframe" src="about:blank" title="External page preview" loading="eager" referrerpolicy="no-referrer-when-downgrade"></iframe>' +
    '</div>';

  document.body.appendChild(overlayEl);

  externalLinkPreviewState.overlayEl = overlayEl;
  externalLinkPreviewState.dialogEl = overlayEl.querySelector('.external-link-modal-dialog');
  externalLinkPreviewState.titleEl = overlayEl.querySelector('.external-link-modal-title');
  externalLinkPreviewState.launchLinkEl = overlayEl.querySelector('.external-link-modal-launch');
  externalLinkPreviewState.iframeEl = overlayEl.querySelector('.external-link-modal-iframe');
  externalLinkPreviewState.closeBtnEl = overlayEl.querySelector('.external-link-modal-close');

  if (!externalLinkPreviewState.eventsBound) {
    externalLinkPreviewState.eventsBound = true;

    overlayEl.addEventListener('click', e => {
      if (e.target === overlayEl) closeExternalLinkPreview();
    });

    externalLinkPreviewState.closeBtnEl.addEventListener('click', () => {
      closeExternalLinkPreview();
    });

    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!externalLinkPreviewState.isOpen) return;
      closeExternalLinkPreview();
    });
  }
}

function getExternalLinkPreviewIframeSrc(url) {
  const href = String(url || '').trim();
  if (!href) return 'about:blank';
  return href.replace(/^http:\/\//i, 'https://');
}

function openExternalLinkPreview(url, label = '') {
  const href = String(url || '').trim();
  if (!href) return;

  ensureExternalLinkPreviewInitialized();

  const title = getDisplayLabelOrFallback(label, href);
  externalLinkPreviewState.titleEl.textContent = title;
  externalLinkPreviewState.launchLinkEl.href = href;
  externalLinkPreviewState.iframeEl.src = getExternalLinkPreviewIframeSrc(href);
  externalLinkPreviewState.overlayEl.hidden = false;
  externalLinkPreviewState.overlayEl.classList.add('is-open');
  externalLinkPreviewState.isOpen = true;
}

function closeExternalLinkPreview() {
  if (!externalLinkPreviewState.overlayEl || !externalLinkPreviewState.isOpen) return;

  externalLinkPreviewState.isOpen = false;
  externalLinkPreviewState.overlayEl.classList.remove('is-open');
  externalLinkPreviewState.overlayEl.hidden = true;
  externalLinkPreviewState.iframeEl.src = 'about:blank';
}

function shouldInterceptExternalLinkPreviewClick(e) {
  if (!e) return false;
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  return true;
}

function bindInfoExternalLinkPreviewEvents(containerEl) {
  if (!containerEl) return;

  containerEl.querySelectorAll('.info-external-link').forEach(el => {
    if (el.dataset.externalPreviewBound === '1') return;
    el.dataset.externalPreviewBound = '1';

    el.addEventListener('click', e => {
      if (!shouldInterceptExternalLinkPreviewClick(e)) return;

      const href = el.getAttribute('href') || '';
      if (!href || href === '#') return;

      e.preventDefault();
      openExternalLinkPreview(href, el.getAttribute('aria-label') || el.getAttribute('title') || 'Link preview');
    });
  });
}

function bindInfoNavigationEvents(containerEl) {
  if (!containerEl) return;

  containerEl.querySelectorAll('[data-navigate]').forEach(el => {
    if (el.dataset.navigateBound === '1') return;
    el.dataset.navigateBound = '1';
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.navigate);
    });
  });
}

function bindInfoActionableEntityRowInteractions(containerEl, config, resourceProfile) {
  if (!containerEl || !config) return;

  bindInfoNavigationEvents(containerEl);
  bindMapPinToggleButtons(containerEl);

  const shouldBindMapPreview =
    config.dataUrnAttribute === 'data-depicted-where-urn'
    || config.dataUrnAttribute === 'data-geojson-feature-urn'
    || (resourceProfile === 'spatial' && config.dataUrnAttribute === 'data-depicted-concept-urn');

  bindInfoActionableEntityHoverEvents(
    containerEl,
    `[${config.dataUrnAttribute}]`,
    config.dataUrnAttribute,
    shouldBindMapPreview
      ? {
          onHoverStart: ({ chip, urn }) => {
            void showInfoChipMapPreview(urn, chip);
          },
          onHoverEnd: ({ chip, urn }) => {
            scheduleInfoChipMapPreviewClear(urn, chip);
          },
        }
      : {}
  );
}

function createDepictedConceptsInfoChipSectionConfig(shortId) {
  return {
    rowClass: 'info-depicted-concepts-row',
    rowSelector: '.info-depicted-concepts-row',
    labelClass: 'info-depicted-concepts-label',
    listClass: 'info-depicted-concepts',
    itemClass: 'info-depicted-entity-chip info-concept-chip',
    sectionLabel: 'Depicted concepts',
    dataUrnAttribute: 'data-depicted-concept-urn',
    enablePin: true,
    pinContextClass: 'map-pin-toggle-info',
    fetcher: () => fetchDepictsConcepts(shortId),
  };
}

function createDepictedWhereInfoChipSectionConfig(shortId, rowClass = 'info-depicted-where-row') {
  return {
    rowClass,
    rowSelector: `.${rowClass.split(' ').join('.')}`,
    labelClass: 'info-depicted-where-label',
    listClass: 'info-depicted-where',
    itemClass: 'info-depicted-entity-chip info-location-chip',
    sectionLabel: 'Depicted where',
    dataUrnAttribute: 'data-depicted-where-urn',
    enablePin: false,
    fetcher: () => fetchDepictedWhereForInfo(shortId),
  };
}

function isSyntheticGeoJsonFeatureUrn(featureUrn, parentUrn = '') {
  const urn = String(featureUrn || '').trim();
  const parent = String(parentUrn || '').trim();
  if (!urn) return true;
  if (parent && urn.startsWith(`${parent}#feature-`)) return true;
  return /#feature-\d+$/i.test(urn);
}

function getGeoJsonFeatureDisplayLabel(featureGeoJson, featureUrn) {
  const props = featureGeoJson && typeof featureGeoJson === 'object' && featureGeoJson.properties
    ? featureGeoJson.properties
    : null;

  const preferred = props
    ? getDisplayLabelOrFallback(props.label || props.title || props.name || '', '')
    : '';
  if (preferred) {
    if (preferred.startsWith('urn:p-lod:id:')) return extractShortId(preferred);
    return preferred;
  }

  return extractShortId(featureUrn);
}

async function fetchGeoJsonFeatureItemsForInfo(entityUrn) {
  if (!entityUrn) return [];

  const normalizedFeatures = await ensurePinnedGeojsonFeatures(entityUrn);
  if (!Array.isArray(normalizedFeatures) || !normalizedFeatures.length) return [];

  const items = [];
  const seen = new Set();
  for (const feature of normalizedFeatures) {
    const featureUrn = String((feature && feature.featureUrn) || '').trim();
    if (!featureUrn || seen.has(featureUrn)) continue;
    if (isSyntheticGeoJsonFeatureUrn(featureUrn, entityUrn)) continue;
    seen.add(featureUrn);

    items.push({
      urn: featureUrn,
      label: getGeoJsonFeatureDisplayLabel(feature.featureGeoJson, featureUrn),
      within: extractShortId(entityUrn),
    });
  }

  return items;
}

function createGeoJsonFeaturesInfoChipSectionConfig(entityUrn) {
  return {
    rowClass: 'info-geojson-features-row',
    rowSelector: '.info-geojson-features-row',
    labelClass: 'info-depicted-where-label',
    listClass: 'info-depicted-where',
    itemClass: 'info-depicted-entity-chip info-location-chip',
    sectionLabel: 'Features',
    dataUrnAttribute: 'data-geojson-feature-urn',
    enablePin: true,
    pinContextClass: 'map-pin-toggle-info',
    fetcher: () => fetchGeoJsonFeatureItemsForInfo(entityUrn),
  };
}

async function fetchGeoJsonFeatureHierarchySeedNodes(entityUrn) {
  if (!entityUrn) return [];

  const normalizedFeatures = await ensurePinnedGeojsonFeatures(entityUrn);
  if (!Array.isArray(normalizedFeatures) || !normalizedFeatures.length) return [];

  const nodes = [];
  const seen = new Set();
  for (const feature of normalizedFeatures) {
    const featureUrn = String((feature && feature.featureUrn) || '').trim();
    if (!featureUrn || seen.has(featureUrn)) continue;
    if (isSyntheticGeoJsonFeatureUrn(featureUrn, entityUrn)) continue;
    seen.add(featureUrn);

    nodes.push({
      urn: featureUrn,
      label: getGeoJsonFeatureDisplayLabel(feature.featureGeoJson, featureUrn),
      type: 'geojson-feature',
      geojson: feature.featureGeoJson || null,
    });
  }

  return nodes;
}

function getInfoChipSectionConfigs(shortId, resourceProfile, resourceTypeUrn = '', entityUrn = '') {
  if (!shortId) return [];
  const isWallPaintingStyle = resourceTypeUrn === POMPEIAN_WALL_PAINTING_STYLE_TYPE;
  const isSpaceCharacterization = resourceTypeUrn === SPACE_CHARACTERIZATION_TYPE;

  if (isSpaceCharacterization && entityUrn) {
    return [createGeoJsonFeaturesInfoChipSectionConfig(entityUrn)];
  }

  if (resourceProfile === 'spatial') {
    const sectionConfigs = [createDepictedConceptsInfoChipSectionConfig(shortId)];
    if (isWallPaintingStyle) {
      sectionConfigs.push(createDepictedWhereInfoChipSectionConfig(shortId, 'info-depicted-where-row info-style-depicted-where-row'));
    }
    return sectionConfigs;
  }

  if (resourceProfile === 'concept') {
    return [createDepictedWhereInfoChipSectionConfig(shortId)];
  }

  return [];
}

function isInfoChipHydrationTargetCurrent(requestToken, entityUrn) {
  if (requestToken !== infoChipSectionHydrationToken) return false;
  if (!entityUrn) return true;
  return document.getElementById('current-id')?.textContent === entityUrn;
}

function hydrateInfoChipSectionRow(containerEl, sectionConfig, items, resourceProfile) {
  if (!containerEl || !sectionConfig) return;

  const rowEl = containerEl.querySelector(sectionConfig.rowSelector);
  if (!rowEl) return;

  if (!items.length) {
    rowEl.remove();
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderActionableInfoEntityRow({
    rowClass: sectionConfig.rowClass,
    labelClass: sectionConfig.labelClass,
    listClass: sectionConfig.listClass,
    itemClass: sectionConfig.itemClass,
    sectionLabel: sectionConfig.sectionLabel,
    dataUrnAttribute: sectionConfig.dataUrnAttribute,
    enablePin: !!sectionConfig.enablePin,
    pinContextClass: sectionConfig.pinContextClass || 'map-pin-toggle-info',
    items,
  });

  const nextRowEl = wrapper.firstElementChild;
  if (!nextRowEl) {
    rowEl.remove();
    return;
  }

  rowEl.replaceWith(nextRowEl);
  bindInfoActionableEntityRowInteractions(nextRowEl, sectionConfig, resourceProfile);
}

function loadInfoChipSectionsAsync({ containerEl, shortId, resourceProfile, resourceTypeUrn = '', entityUrn }) {
  const sectionConfigs = getInfoChipSectionConfigs(shortId, resourceProfile, resourceTypeUrn, entityUrn);
  if (!containerEl || !sectionConfigs.length) return;

  const requestToken = ++infoChipSectionHydrationToken;

  sectionConfigs.forEach(sectionConfig => {
    void sectionConfig.fetcher()
      .then(rawItems => {
        if (!isInfoChipHydrationTargetCurrent(requestToken, entityUrn)) return;

        const normalizedItems = normalizeUniqueRelatedEntityItems(rawItems);
        hydrateInfoChipSectionRow(containerEl, sectionConfig, normalizedItems, resourceProfile);
      })
      .catch(() => {
        if (!isInfoChipHydrationTargetCurrent(requestToken, entityUrn)) return;
        hydrateInfoChipSectionRow(containerEl, sectionConfig, [], resourceProfile);
      });
  });
}

function bindInfoChipPreviewState(chip, { isLoading = false, isActive = false } = {}) {
  if (!chip) return;
  chip.classList.toggle('is-loading', !!isLoading);
  chip.classList.toggle('is-map-preview-active', !!isActive);
  if (isLoading) {
    chip.setAttribute('aria-busy', 'true');
  } else {
    chip.removeAttribute('aria-busy');
  }
}

function bindInfoActionableEntityHoverEvents(el, selector, urnAttrName, options = {}) {
  const { onHoverStart = null, onHoverEnd = null } = options;

  el.querySelectorAll(selector).forEach(chip => {
    const urn = chip.getAttribute(urnAttrName);
    if (!urn) return;

    chip.addEventListener('mouseenter', () => {
      if (typeof onHoverStart === 'function') onHoverStart({ chip, urn });
      paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn, shouldPan: false, source: 'info' });
    });

    chip.addEventListener('mouseleave', () => {
      if (typeof onHoverEnd === 'function') onHoverEnd({ chip, urn });
      paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn, source: 'info' });
    });

    chip.addEventListener('focus', () => {
      if (typeof onHoverStart === 'function') onHoverStart({ chip, urn });
      paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn, shouldPan: false, source: 'info' });
    });

    chip.addEventListener('blur', () => {
      if (typeof onHoverEnd === 'function') onHoverEnd({ chip, urn });
      paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn, source: 'info' });
    });
  });
}

async function fetchDepictsConcepts(shortId) {
  try {
    const r = await fetch(`${API_BASE}/depicts-concepts/${encodeURIComponent(shortId)}`);
    if (!r.ok) return [];
    const payload = await r.json();
    return Array.isArray(payload) ? payload : [];
  } catch (_) {
    return [];
  }
}

async function fetchDepictedWhereForInfo(shortId) {
  const payload = await fetchDepictedWhereAtDetailLevel(shortId, 'space');
  return Array.isArray(payload) ? payload : [];
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

const GEOJSON_FEATURE_URN_PROPERTY_KEYS = Object.freeze([
  'urn',
  'feature_urn',
  'featureUrn',
  'entity_urn',
  'entityUrn',
  'p_lod_id',
  'id',
]);

function normalizeGeoJsonFeatureUrnCandidate(rawUrn) {
  const value = String(rawUrn || '').trim();
  if (!value || value === 'None') return '';

  if (value.startsWith('urn:p-lod:id:')) return value;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return '';

  return normalizeId(value);
}

function resolveGeoJsonFeatureUrn(feature, fallbackUrn, index) {
  if (feature && typeof feature === 'object') {
    const fromId = normalizeGeoJsonFeatureUrnCandidate(feature.id);
    if (fromId) return fromId;

    const props = (feature.properties && typeof feature.properties === 'object')
      ? feature.properties
      : null;
    if (props) {
      for (const key of GEOJSON_FEATURE_URN_PROPERTY_KEYS) {
        const candidate = normalizeGeoJsonFeatureUrnCandidate(props[key]);
        if (candidate) return candidate;
      }
    }
  }

  const base = normalizeGeoJsonFeatureUrnCandidate(fallbackUrn);
  if (!base) return '';
  return `${base}#feature-${index + 1}`;
}

function normalizeGeoJsonFeatures(gjInput, options = {}) {
  const { fallbackUrn = '' } = options;
  const parsed = parseGeoJson(gjInput);
  if (!parsed || typeof parsed !== 'object') return [];

  let sourceFeatures = [];
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    sourceFeatures = parsed.features;
  } else if (parsed.type === 'Feature') {
    sourceFeatures = [parsed];
  } else if (parsed.type) {
    sourceFeatures = [{ type: 'Feature', geometry: parsed, properties: {} }];
  }

  const normalized = [];
  const seenFeatureUrns = new Set();

  for (let i = 0; i < sourceFeatures.length; i++) {
    const feature = sourceFeatures[i];
    if (!feature || typeof feature !== 'object') continue;

    const geometry = feature.geometry || null;
    if (!geometry || typeof geometry !== 'object') continue;

    const featureUrn = resolveGeoJsonFeatureUrn(feature, fallbackUrn, i);
    if (!featureUrn || seenFeatureUrns.has(featureUrn)) continue;
    seenFeatureUrns.add(featureUrn);

    const normalizedFeature = {
      type: 'Feature',
      geometry,
      properties: {
        ...((feature.properties && typeof feature.properties === 'object') ? feature.properties : {}),
      },
    };
    if (feature.id !== undefined && feature.id !== null && feature.id !== '') {
      normalizedFeature.id = feature.id;
    }

    normalized.push({
      featureUrn,
      featureGeoJson: normalizedFeature,
    });
  }

  return normalized;
}

function debounce(fn, waitMs) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), waitMs);
  };
}

function getInfoChipSuppressedPredicateTails(chipSectionConfigs) {
  const tails = new Set();
  for (const config of (chipSectionConfigs || [])) {
    if (!config || !config.dataUrnAttribute) continue;
    if (config.dataUrnAttribute === 'data-depicted-concept-urn') tails.add('depicts-concepts');
    if (config.dataUrnAttribute === 'data-depicted-where-urn') tails.add('depicted-where');
  }
  return tails;
}

function normalizeTypeaheadRecord(item, sourceType) {
  if (!item || !item.urn) return null;

  const shortId = extractShortId(item.urn).trim();
  if (!shortId) return null;

  let itemType = sourceType;
  if (item.type && String(item.type).startsWith('urn:p-lod:id:')) {
    itemType = extractShortId(item.type);
  }

  const label = getDisplayLabelOrFallback(item.label, '');

  return { shortId, label, type: itemType };
}

function getBestImageUrnsFromTriples(triples) {
  const urns = [];
  const seen = new Set();
  const vals = (triples && triples['urn:p-lod:id:best-image']) || [];

  for (const val of vals) {
    const urn = String(val || '').trim();
    if (!urn.startsWith('urn:p-lod:id:')) continue;
    if (seen.has(urn)) continue;
    seen.add(urn);
    urns.push(urn);
  }

  return urns;
}

function getImageItemUrn(item) {
  if (typeof item === 'string') return String(item || '').trim();
  return String((item && item.urn) || '').trim();
}

function mergePriorityImages(bestImageUrns, imageItems, contextEntityUrn = '') {
  const items = Array.isArray(imageItems) ? imageItems : [];
  const result = [];
  const seenUrns = new Set();

  for (const bestUrn of (bestImageUrns || [])) {
    const urn = String(bestUrn || '').trim();
    if (!urn || seenUrns.has(urn)) continue;
    seenUrns.add(urn);

    const existing = items.find(item => getImageItemUrn(item) === urn);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        urn,
        entity: contextEntityUrn,
      });
    }
  }

  for (const item of items) {
    const urn = getImageItemUrn(item);
    if (!urn || seenUrns.has(urn)) continue;
    seenUrns.add(urn);
    result.push(item);
  }

  return result;
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

function fetchSpatialChildren(shortId) {
  return fetch(`${API_BASE}/spatial-children/${encodeURIComponent(shortId)}`)
    .then(r => r.ok ? r.json() : [])
    .catch(() => []);
}

function fetchEntityImages(shortId) {
  return fetch(`${API_BASE}/images/${encodeURIComponent(shortId)}`)
    .then(r => r.ok ? r.json() : [])
    .catch(() => []);
}

function renderImagePaneHoverPreviewHint(slotEl) {
  if (!slotEl) return;
  slotEl.innerHTML = '<p class="placeholder">Hover over a map feature to load images for that feature.</p>';
}

function extractEndpointShortId(urn) {
  return extractShortId(urn).replace(/#.*$/, '');
}

async function buildSpatialSelfMapItem(entityUrn, shortId, label, selfGjStr, forceGeojsonEndpoint = false) {
  let gjStr = forceGeojsonEndpoint ? null : selfGjStr;
  if (!gjStr) {
    try {
      const r = await fetch(`${API_BASE}/geojson/${encodeURIComponent(shortId)}`);
      if (r.ok) gjStr = JSON.stringify(await r.json());
    } catch (_) { /* ignore */ }
  }

  if (!gjStr || gjStr === 'None') return null;
  return { urn: entityUrn, label, geojson: gjStr };
}

function createResourceHandler({
  key,
  profile,
  isSpatial = false,
  imagesPaneBehavior = IMAGE_PANE_BEHAVIOR.CONCEPT_PRELOAD,
  promoteSelfGeometryToPrimaryLayer = false,
  spatialMapSource = 'spatial-children',
  forceSelfGeojsonFromEndpoint = false,
  hierarchySeedSource = 'none',
}) {
  return Object.freeze({
    key,
    profile,
    isSpatial,
    imagesPaneBehavior,
    promoteSelfGeometryToPrimaryLayer,
    resolvePaneLayout(overrideLayout) {
      if (overrideLayout) {
        return {
          profile,
          layout: normalizePaneLayout(overrideLayout, DEFAULT_PANE_LAYOUT),
          fromOverride: true,
        };
      }

      return {
        profile,
        layout: getDefaultPaneLayoutForProfile(profile),
        fromOverride: false,
      };
    },
    getHierarchyProfile() {
      return profile === 'concept' || profile === 'spatial' ? profile : null;
    },
    getHierarchySeedNodes(currentNode) {
      if (hierarchySeedSource !== 'geojson-features') return Promise.resolve([]);
      return fetchGeoJsonFeatureHierarchySeedNodes(currentNode && currentNode.urn ? currentNode.urn : '');
    },
    getImagesPromise(shortId) {
      if (imagesPaneBehavior === IMAGE_PANE_BEHAVIOR.CONCEPT_PRELOAD) return Promise.resolve(null);
      if (imagesPaneBehavior === IMAGE_PANE_BEHAVIOR.FEATURE_HOVER_PREVIEW) return Promise.resolve([]);
      return fetchEntityImages(shortId);
    },
    getMapDataPromise(shortId) {
      if (isSpatial) {
        if (spatialMapSource === 'none') return Promise.resolve([]);
        return spatialMapSource === 'depicted-where-fallback'
          ? fetchDepictedWhereWithSpaceFallback(shortId)
          : fetchSpatialChildren(shortId);
      }

      return fetchDepictedWhereWithSpaceFallback(shortId);
    },
    getChildItems(mapResult) {
      if (isSpatial && spatialMapSource === 'depicted-where-fallback') {
        return {
          childItems: (mapResult && mapResult.items) || [],
          conceptDetailLevel: (mapResult && mapResult.detailLevel) || 'feature',
        };
      }

      if (isSpatial) {
        return {
          childItems: mapResult || [],
          conceptDetailLevel: 'feature',
        };
      }

      return {
        childItems: (mapResult && mapResult.items) || [],
        conceptDetailLevel: (mapResult && mapResult.detailLevel) || 'feature',
      };
    },
    renderImagesPane({ bestImageUrns, imagesResult, childItems, slotEl, entityUrn }) {
      if (imagesPaneBehavior === IMAGE_PANE_BEHAVIOR.CONCEPT_PRELOAD) {
        setImagePaneContext({
          behavior: imagesPaneBehavior,
          entityUrn,
          slotEl,
          renderBase: () => renderConceptImages(childItems, slotEl, bestImageUrns, entityUrn),
        });
        return;
      }

      if (imagesPaneBehavior === IMAGE_PANE_BEHAVIOR.FEATURE_HOVER_PREVIEW) {
        setImagePaneContext({
          behavior: imagesPaneBehavior,
          entityUrn,
          slotEl,
          renderBase: () => renderImagePaneHoverPreviewHint(slotEl),
        });
        return;
      }

      const mergedImages = mergePriorityImages(bestImageUrns, imagesResult || [], entityUrn);
      setImagePaneContext({
        behavior: imagesPaneBehavior,
        entityUrn,
        slotEl,
        renderBase: () => renderImages(mergedImages, slotEl, entityUrn),
      });
    },
    buildSelfMapItem(entityUrn, shortId, label, selfGjStr) {
      if (!isSpatial) return Promise.resolve(null);
      return buildSpatialSelfMapItem(
        entityUrn,
        shortId,
        label,
        selfGjStr,
        forceSelfGeojsonFromEndpoint
      );
    },
  });
}

const DEFAULT_RESOURCE_HANDLER = createResourceHandler({
  key: 'default',
  profile: 'default',
  imagesPaneBehavior: IMAGE_PANE_BEHAVIOR.CONCEPT_PRELOAD,
});
const CONCEPT_RESOURCE_HANDLER = createResourceHandler({
  key: 'concept',
  profile: 'concept',
  imagesPaneBehavior: IMAGE_PANE_BEHAVIOR.CONCEPT_PRELOAD,
});
const SPATIAL_RESOURCE_HANDLER = createResourceHandler({
  key: 'spatial',
  profile: 'spatial',
  isSpatial: true,
  imagesPaneBehavior: IMAGE_PANE_BEHAVIOR.SPATIAL_PRELOAD,
});
const WALL_PAINTING_STYLE_RESOURCE_HANDLER = createResourceHandler({
  key: 'pompeian-wall-painting-style',
  profile: 'spatial',
  isSpatial: true,
  imagesPaneBehavior: IMAGE_PANE_BEHAVIOR.SPATIAL_PRELOAD,
  promoteSelfGeometryToPrimaryLayer: true,
  spatialMapSource: 'depicted-where-fallback',
});
const SPACE_CHARACTERIZATION_RESOURCE_HANDLER = createResourceHandler({
  key: 'space-characterization',
  profile: 'spatial',
  isSpatial: true,
  imagesPaneBehavior: IMAGE_PANE_BEHAVIOR.FEATURE_HOVER_PREVIEW,
  promoteSelfGeometryToPrimaryLayer: true,
  spatialMapSource: 'none',
  forceSelfGeojsonFromEndpoint: true,
  hierarchySeedSource: 'geojson-features',
});

const RESOURCE_TYPE_HANDLERS = Object.freeze({
  [POMPEIAN_WALL_PAINTING_STYLE_TYPE]: WALL_PAINTING_STYLE_RESOURCE_HANDLER,
  [SPACE_CHARACTERIZATION_TYPE]: SPACE_CHARACTERIZATION_RESOURCE_HANDLER,
});

const RESOURCE_FAMILY_HANDLERS = Object.freeze({
  default: DEFAULT_RESOURCE_HANDLER,
  concept: CONCEPT_RESOURCE_HANDLER,
  spatial: SPATIAL_RESOURCE_HANDLER,
});

function resolveResourceHandlerFamily(typeUrn) {
  if (SPATIAL_TYPES.has(typeUrn)) return 'spatial';
  if (typeUrn === 'urn:p-lod:id:concept') return 'concept';
  return 'default';
}

function resolveResourceHandler(typeUrn) {
  return RESOURCE_TYPE_HANDLERS[typeUrn]
    || RESOURCE_FAMILY_HANDLERS[resolveResourceHandlerFamily(typeUrn)]
    || RESOURCE_FAMILY_HANDLERS.default;
}

function resolveResourceProfile(typeUrn) {
  return resolveResourceHandler(typeUrn).profile;
}

function getDefaultPaneLayoutForProfile(profile) {
  const fromProfile = LAYOUT_DEFAULTS_BY_RESOURCE_PROFILE[profile] || LAYOUT_DEFAULTS_BY_RESOURCE_PROFILE.default;
  return normalizePaneLayout(fromProfile, DEFAULT_PANE_LAYOUT);
}

function resolvePaneLayout(typeUrn, overrideLayout) {
  return resolveResourceHandler(typeUrn).resolvePaneLayout(overrideLayout);
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
let layersByEntityUrn = new Map();   // URN → { layers, boundsLayer, defaultStyle } for hover linkage
let mapFeatureOwnerUrnByFeatureUrn = new Map(); // featureUrn -> owner entity/layer URN
let geojsonFeaturePayloadByUrn = new Map(); // featureUrn -> normalized GeoJSON Feature payload
let geojsonFeatureUrnsByPinUrn = new Map(); // pinUrn -> Set<featureUrn>
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
let infoChipSectionHydrationToken = 0;
let infoChipPreviewLayer = null;
let infoChipPreviewUrn = null;
let infoChipPreviewRequestToken = 0;
let infoChipPreviewClearTimeoutId = null;
let activeInfoChipPreviewChipEl = null;
let infoChipPreviewGeoJsonCache = new Map();
let pendingInfoChipPreviewGeoJsonByUrn = new Map();
let pinnedGeojsonUrns = new Set(); // pin target URNs as used by UI controls
let pinnedGeojsonLayerByUrn = new Map(); // featureUrn -> Leaflet layer
let pinnedGeojsonFeatureUrnsByPinUrn = new Map(); // pinUrn -> Set<featureUrn>
let pinnedGeojsonCacheByUrn = new Map(); // pinUrn -> normalized features [{ featureUrn, featureGeoJson }]
let pendingPinnedGeojsonByUrn = new Map(); // pinUrn -> Promise<normalizedFeatures[]>
let pinnedGeojsonRequestToken = 0;
let currentImagePaneBehavior = IMAGE_PANE_BEHAVIOR.CONCEPT_PRELOAD;
let currentImagePaneEntityUrn = '';
let currentImagePaneSlotEl = null;
let currentImagePaneBaseRenderer = null;
let imagePanePreviewActiveUrn = '';
let imagePanePreviewIntentTimeoutId = null;
let imagePanePreviewRenderToken = 0;
let imagePanePreviewImagesCacheByUrn = new Map();
let pendingImagePanePreviewImagesByUrn = new Map();
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

const INFO_CHIP_PREVIEW_STYLE = Object.freeze({
  color: '#1f7a58',
  weight: 4,
  fillColor: '#4cc38a',
  fillOpacity: 0.28,
  opacity: 1,
});

const PINNED_GEOJSON_STYLE = Object.freeze({
  color: '#0e5f8b',
  weight: 3,
  fillColor: '#4aa7d1',
  fillOpacity: 0.22,
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

function clearImagePanePreviewIntentTimeout() {
  if (!imagePanePreviewIntentTimeoutId) return;
  clearTimeout(imagePanePreviewIntentTimeoutId);
  imagePanePreviewIntentTimeoutId = null;
}

function setImagePaneContext({ behavior, entityUrn, slotEl, renderBase }) {
  imagePanePreviewRenderToken += 1;
  clearImagePanePreviewIntentTimeout();
  imagePanePreviewActiveUrn = '';

  currentImagePaneBehavior = behavior || IMAGE_PANE_BEHAVIOR.CONCEPT_PRELOAD;
  currentImagePaneEntityUrn = String(entityUrn || '').trim();
  currentImagePaneSlotEl = slotEl || null;
  currentImagePaneBaseRenderer = typeof renderBase === 'function' ? renderBase : null;

  if (currentImagePaneBaseRenderer) currentImagePaneBaseRenderer();
}

function restoreImagePaneBaseContent() {
  if (!currentImagePaneBaseRenderer) return;
  currentImagePaneBaseRenderer();
}

function clearImagePanePreviewState(options = {}) {
  const { clearCache = false, restoreBase = false } = options;

  imagePanePreviewRenderToken += 1;
  clearImagePanePreviewIntentTimeout();
  imagePanePreviewActiveUrn = '';

  if (restoreBase) restoreImagePaneBaseContent();
  if (clearCache) {
    imagePanePreviewImagesCacheByUrn.clear();
    pendingImagePanePreviewImagesByUrn.clear();
  }
}

async function ensureImagePanePreviewImages(featureUrn) {
  if (!featureUrn) return [];
  if (imagePanePreviewImagesCacheByUrn.has(featureUrn)) {
    return imagePanePreviewImagesCacheByUrn.get(featureUrn) || [];
  }
  if (pendingImagePanePreviewImagesByUrn.has(featureUrn)) {
    return pendingImagePanePreviewImagesByUrn.get(featureUrn);
  }

  const pending = (async () => {
    try {
      const shortId = extractEndpointShortId(featureUrn);
      if (!shortId) {
        imagePanePreviewImagesCacheByUrn.set(featureUrn, []);
        return [];
      }

      const images = await fetchEntityImages(shortId);
      const normalized = Array.isArray(images)
        ? images.map(item => (item && typeof item === 'object'
          ? { ...item, feature: item.feature || featureUrn }
          : item))
        : [];

      imagePanePreviewImagesCacheByUrn.set(featureUrn, normalized);
      return normalized;
    } catch (_) {
      imagePanePreviewImagesCacheByUrn.set(featureUrn, []);
      return [];
    } finally {
      pendingImagePanePreviewImagesByUrn.delete(featureUrn);
    }
  })();

  pendingImagePanePreviewImagesByUrn.set(featureUrn, pending);
  return pending;
}

function requestImagePaneFeaturePreview(featureUrn) {
  if (currentImagePaneBehavior !== IMAGE_PANE_BEHAVIOR.FEATURE_HOVER_PREVIEW) return;
  if (!featureUrn || !currentImagePaneSlotEl || !currentImagePaneEntityUrn) return;
  if (isSyntheticGeoJsonFeatureUrn(featureUrn, currentImagePaneEntityUrn)) return;

  clearImagePanePreviewIntentTimeout();
  const token = ++imagePanePreviewRenderToken;

  imagePanePreviewIntentTimeoutId = setTimeout(() => {
    imagePanePreviewIntentTimeoutId = null;
    if (token !== imagePanePreviewRenderToken) return;

    imagePanePreviewActiveUrn = featureUrn;
    if (currentImagePaneSlotEl) {
      currentImagePaneSlotEl.innerHTML = '<p class="loading">Loading feature images…</p>';
    }

    void ensureImagePanePreviewImages(featureUrn).then(images => {
      if (token !== imagePanePreviewRenderToken) return;
      if (imagePanePreviewActiveUrn !== featureUrn) return;

      const mergedImages = mergePriorityImages([], images || [], featureUrn);
      renderImages(mergedImages, currentImagePaneSlotEl, currentImagePaneEntityUrn);
    });
  }, IMAGE_HOVER_INTENT_DELAY_MS);
}

function clearImagePaneFeaturePreview() {
  if (currentImagePaneBehavior !== IMAGE_PANE_BEHAVIOR.FEATURE_HOVER_PREVIEW) return;
  clearImagePanePreviewState({ restoreBase: true });
}

function cancelImagePaneFeaturePreviewRequest() {
  if (currentImagePaneBehavior !== IMAGE_PANE_BEHAVIOR.FEATURE_HOVER_PREVIEW) return;

  // Keep the currently rendered preview in place so users can move into the
  // image pane and interact; only cancel the pending hover-intent request.
  imagePanePreviewRenderToken += 1;
  clearImagePanePreviewIntentTimeout();
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
  if (!entry || !Array.isArray(entry.layers) || !entry.layers.length) return;

  cancelAttentionPulseForUrn(urn);

  entry.layers.forEach(layer => layer.setStyle({ ...HIGHLIGHT_STYLE, color: '#ffe066', weight: 12, fillOpacity: 0.85 }));

  const timeoutId = setTimeout(() => {
    if (currentHoveredEntityUrn !== urn) return;
    entry.layers.forEach(layer => layer.setStyle({ ...HIGHLIGHT_STYLE, color: '#ffb300', weight: 8, fillOpacity: 0.68 }));

    const settleTimeoutId = setTimeout(() => {
      if (currentHoveredEntityUrn !== urn) return;
      entry.layers.forEach(layer => layer.setStyle(HIGHLIGHT_STYLE));
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
    L.tileLayer('http://p-lod.org/xyz-tiles/{z}/{x}/{y}.png', {
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
  clearInfoChipMapPreview({ clearChipState: true, clearCache: true });
  clearPinnedGeojsonState({ clearCache: true, removeLayers: false });
  if (mapFocusHintTimeoutId) {
    clearTimeout(mapFocusHintTimeoutId);
    mapFocusHintTimeoutId = null;
  }
  if (mapFocusHintEl) mapFocusHintEl.classList.remove('is-visible');
  if (layerGroup) layerGroup.clearLayers();
  clearImagePanePreviewState({ restoreBase: false });
  layersByEntityUrn.clear();
  mapFeatureOwnerUrnByFeatureUrn.clear();
  geojsonFeaturePayloadByUrn.clear();
  geojsonFeatureUrnsByPinUrn.clear();
  spatialHoverCache.clear();
  ancestorByEntityUrnCache.clear();
  ancestorOutlineLayerCache.clear();
  pendingAncestorByEntityUrn.clear();
  pendingAncestorOutlineLayerByUrn.clear();
  activeAncestorOutlineUrn = null;
  currentHoveredEntityUrn = null;
}

function clearInfoChipPreviewClearTimeout() {
  if (!infoChipPreviewClearTimeoutId) return;
  clearTimeout(infoChipPreviewClearTimeoutId);
  infoChipPreviewClearTimeoutId = null;
}

function clearInfoChipMapPreviewLayer() {
  if (infoChipPreviewLayer && layerGroup && layerGroup.hasLayer(infoChipPreviewLayer)) {
    layerGroup.removeLayer(infoChipPreviewLayer);
  }
  infoChipPreviewLayer = null;
  infoChipPreviewUrn = null;
}

function clearInfoChipMapPreview(options = {}) {
  const { clearChipState = false, clearCache = false } = options;
  infoChipPreviewRequestToken += 1;
  clearInfoChipPreviewClearTimeout();
  clearInfoChipMapPreviewLayer();

  if (clearChipState && activeInfoChipPreviewChipEl) {
    bindInfoChipPreviewState(activeInfoChipPreviewChipEl, { isLoading: false, isActive: false });
    activeInfoChipPreviewChipEl = null;
  }

  if (clearCache) {
    infoChipPreviewGeoJsonCache.clear();
    pendingInfoChipPreviewGeoJsonByUrn.clear();
  }
}

function getCanonicalMapPinUrn(rawUrn) {
  const urn = String(rawUrn || '').trim();
  if (!urn) return '';

  // Already a known feature URN: keep it as the canonical target.
  if (geojsonFeaturePayloadByUrn.has(urn)) return urn;

  // If this URN maps to exactly one feature, canonicalize to that feature URN.
  const featureUrns = getGeoJsonFeatureUrnsForPinUrn(urn);
  if (featureUrns.length === 1) return featureUrns[0];

  return urn;
}

function isMapGeojsonPinned(rawUrn) {
  const canonicalUrn = getCanonicalMapPinUrn(rawUrn);
  if (!canonicalUrn) return false;

  if (pinnedGeojsonUrns.has(canonicalUrn)) return true;

  // Keep legacy toggle behavior coherent when a parent/group URN is pinned.
  if (canonicalUrn !== rawUrn && pinnedGeojsonUrns.has(String(rawUrn || '').trim())) {
    return true;
  }

  return false;
}

function registerGeoJsonFeatureUrn(pinUrn, featureUrn) {
  if (!pinUrn || !featureUrn) return;

  if (!geojsonFeatureUrnsByPinUrn.has(pinUrn)) {
    geojsonFeatureUrnsByPinUrn.set(pinUrn, new Set());
  }
  geojsonFeatureUrnsByPinUrn.get(pinUrn).add(featureUrn);
}

function getGeoJsonFeatureUrnsForPinUrn(pinUrn) {
  const direct = geojsonFeatureUrnsByPinUrn.get(pinUrn);
  if (!direct) return [];
  return Array.from(direct.values());
}

function removePinnedGeojsonLayer(featureUrn) {
  const layer = pinnedGeojsonLayerByUrn.get(featureUrn);
  if (!layer) return;
  if (layerGroup && layerGroup.hasLayer(layer)) layerGroup.removeLayer(layer);
  pinnedGeojsonLayerByUrn.delete(featureUrn);
}

function removePinnedGeojsonLayersForPinUrn(pinUrn) {
  const featureUrns = pinnedGeojsonFeatureUrnsByPinUrn.get(pinUrn);
  if (!featureUrns || !featureUrns.size) return;

  featureUrns.forEach(featureUrn => removePinnedGeojsonLayer(featureUrn));
  pinnedGeojsonFeatureUrnsByPinUrn.delete(pinUrn);
}

function bringPinnedGeojsonLayersToFront() {
  if (!layerGroup) return;
  pinnedGeojsonLayerByUrn.forEach(layer => {
    if (layerGroup.hasLayer(layer)) layer.bringToFront();
  });
}

function clearPinnedGeojsonState(options = {}) {
  const { clearCache = false, removeLayers = true } = options;
  pinnedGeojsonRequestToken += 1;

  if (removeLayers) {
    Array.from(pinnedGeojsonLayerByUrn.keys()).forEach(removePinnedGeojsonLayer);
  }

  pinnedGeojsonUrns.clear();
  pinnedGeojsonLayerByUrn.clear();
  pinnedGeojsonFeatureUrnsByPinUrn.clear();
  pendingPinnedGeojsonByUrn.clear();
  if (clearCache) pinnedGeojsonCacheByUrn.clear();
  refreshMapPinToggleButtons();
}

function setMapGeojsonPinState(rawPinUrn, shouldPin) {
  const pinUrn = getCanonicalMapPinUrn(rawPinUrn);
  if (!pinUrn) return;

  if (shouldPin) {
    pinnedGeojsonUrns.add(pinUrn);
  } else {
    pinnedGeojsonUrns.delete(pinUrn);
    removePinnedGeojsonLayersForPinUrn(pinUrn);
  }

  refreshMapPinToggleButtons(rawPinUrn);
  if (pinUrn !== rawPinUrn) refreshMapPinToggleButtons(pinUrn);
}

function cachePinnedGeojsonFeatures(pinUrn, normalizedFeatures) {
  const features = Array.isArray(normalizedFeatures) ? normalizedFeatures : [];
  pinnedGeojsonCacheByUrn.set(pinUrn, features);

  const featureUrns = new Set();
  for (const feature of features) {
    if (!feature || !feature.featureUrn || !feature.featureGeoJson) continue;
    featureUrns.add(feature.featureUrn);
    geojsonFeaturePayloadByUrn.set(feature.featureUrn, feature.featureGeoJson);
    registerGeoJsonFeatureUrn(pinUrn, feature.featureUrn);
    registerGeoJsonFeatureUrn(feature.featureUrn, feature.featureUrn);
  }

  return features;
}

async function ensurePinnedGeojsonFeatures(rawPinUrn) {
  const pinUrn = getCanonicalMapPinUrn(rawPinUrn);
  if (!pinUrn) return [];
  if (pinnedGeojsonCacheByUrn.has(pinUrn)) return pinnedGeojsonCacheByUrn.get(pinUrn);
  if (pendingPinnedGeojsonByUrn.has(pinUrn)) return pendingPinnedGeojsonByUrn.get(pinUrn);

  // Canonical feature URN can be fulfilled from the in-memory feature payload cache.
  if (geojsonFeaturePayloadByUrn.has(pinUrn)) {
    return cachePinnedGeojsonFeatures(pinUrn, [{
      featureUrn: pinUrn,
      featureGeoJson: geojsonFeaturePayloadByUrn.get(pinUrn),
    }]);
  }

  const knownFeatureUrns = getGeoJsonFeatureUrnsForPinUrn(pinUrn);
  if (knownFeatureUrns.length) {
    const knownFeatures = knownFeatureUrns
      .map(featureUrn => ({
        featureUrn,
        featureGeoJson: geojsonFeaturePayloadByUrn.get(featureUrn) || null,
      }))
      .filter(feature => !!feature.featureGeoJson);

    if (knownFeatures.length) {
      return cachePinnedGeojsonFeatures(pinUrn, knownFeatures);
    }
  }

  const pending = (async () => {
    try {
      const shortId = extractShortId(pinUrn);
      const r = await fetch(`${API_BASE}/geojson/${encodeURIComponent(shortId)}`);
      if (!r.ok) return cachePinnedGeojsonFeatures(pinUrn, []);

      const payload = await r.json();
      const geojson = payload && payload.geojson ? payload.geojson : payload;
      const normalized = normalizeGeoJsonFeatures(geojson, { fallbackUrn: pinUrn });
      return cachePinnedGeojsonFeatures(pinUrn, normalized);
    } catch (_) {
      return cachePinnedGeojsonFeatures(pinUrn, []);
    } finally {
      pendingPinnedGeojsonByUrn.delete(pinUrn);
    }
  })();

  pendingPinnedGeojsonByUrn.set(pinUrn, pending);
  return pending;
}

function ensurePinnedGeojsonLayerForFeature(featureUrn, featureGeoJson) {
  if (!featureUrn || !featureGeoJson || !layerGroup) return null;

  const existing = pinnedGeojsonLayerByUrn.get(featureUrn);
  if (existing) {
    if (!layerGroup.hasLayer(existing)) existing.addTo(layerGroup);
    existing.bringToFront();
    return existing;
  }

  const layer = L.geoJSON(featureGeoJson, {
    style: { ...PINNED_GEOJSON_STYLE, className: 'plod-pinned-geojson' },
    interactive: false,
  }).addTo(layerGroup);
  layer.bringToFront();
  pinnedGeojsonLayerByUrn.set(featureUrn, layer);
  return layer;
}

async function ensurePinnedGeojsonLayerForUrn(rawPinUrn) {
  const pinUrn = getCanonicalMapPinUrn(rawPinUrn);
  if (!pinUrn || !leafletMap || !layerGroup) return [];
  if (!isMapGeojsonPinned(pinUrn)) return [];

  const requestToken = pinnedGeojsonRequestToken;
  const features = await ensurePinnedGeojsonFeatures(pinUrn);
  if (requestToken !== pinnedGeojsonRequestToken) return [];
  if (!isMapGeojsonPinned(pinUrn)) return [];

  const featureUrns = new Set();
  const layers = [];
  for (const feature of features) {
    if (!feature || !feature.featureUrn || !feature.featureGeoJson) continue;
    featureUrns.add(feature.featureUrn);
    const layer = ensurePinnedGeojsonLayerForFeature(feature.featureUrn, feature.featureGeoJson);
    if (layer) layers.push(layer);
  }

  pinnedGeojsonFeatureUrnsByPinUrn.set(pinUrn, featureUrns);

  return layers;
}

async function toggleMapGeojsonPin(rawPinUrn) {
  const pinUrn = getCanonicalMapPinUrn(rawPinUrn);
  if (!pinUrn) return;

  const shouldPin = !isMapGeojsonPinned(pinUrn);
  setMapGeojsonPinState(pinUrn, shouldPin);

  if (!shouldPin) return;

  if (hierarchyPreviewUrn === pinUrn || hierarchyPreviewUrn === rawPinUrn) clearHierarchyPreview();
  if (infoChipPreviewUrn === pinUrn || infoChipPreviewUrn === rawPinUrn) {
    clearInfoChipMapPreviewLayer();
    if (activeInfoChipPreviewChipEl) {
      bindInfoChipPreviewState(activeInfoChipPreviewChipEl, { isLoading: false, isActive: true });
    }
  }

  const layers = await ensurePinnedGeojsonLayerForUrn(pinUrn);
  if (!layers.length) {
    setMapGeojsonPinState(pinUrn, false);
    return;
  }

  bringPinnedGeojsonLayersToFront();
}

async function ensureInfoChipPreviewGeoJson(urn) {
  if (!urn) return null;
  if (infoChipPreviewGeoJsonCache.has(urn)) return infoChipPreviewGeoJsonCache.get(urn);
  if (pendingInfoChipPreviewGeoJsonByUrn.has(urn)) return pendingInfoChipPreviewGeoJsonByUrn.get(urn);

  const pending = (async () => {
    try {
      const shortId = extractShortId(urn);
      const r = await fetch(`${API_BASE}/geojson/${encodeURIComponent(shortId)}`);
      if (!r.ok) return null;

      const payload = await r.json();
      const geojson = payload && payload.geojson ? payload.geojson : payload;
      infoChipPreviewGeoJsonCache.set(urn, geojson || null);
      return geojson || null;
    } catch (_) {
      infoChipPreviewGeoJsonCache.set(urn, null);
      return null;
    } finally {
      pendingInfoChipPreviewGeoJsonByUrn.delete(urn);
    }
  })();

  pendingInfoChipPreviewGeoJsonByUrn.set(urn, pending);
  return pending;
}

async function showInfoChipMapPreview(urn, chip) {
  if (!urn || !chip || !leafletMap || !layerGroup) return;
  if (currentResourceProfile !== 'spatial' && currentResourceProfile !== 'concept') return;

  if (isMapGeojsonPinned(urn)) {
    clearInfoChipPreviewClearTimeout();
    if (activeInfoChipPreviewChipEl && activeInfoChipPreviewChipEl !== chip) {
      bindInfoChipPreviewState(activeInfoChipPreviewChipEl, { isLoading: false, isActive: false });
    }
    activeInfoChipPreviewChipEl = chip;
    bindInfoChipPreviewState(chip, { isLoading: false, isActive: true });
    bringPinnedGeojsonLayersToFront();
    return;
  }

  clearInfoChipPreviewClearTimeout();
  const requestToken = ++infoChipPreviewRequestToken;

  if (activeInfoChipPreviewChipEl && activeInfoChipPreviewChipEl !== chip) {
    bindInfoChipPreviewState(activeInfoChipPreviewChipEl, { isLoading: false, isActive: false });
  }
  activeInfoChipPreviewChipEl = chip;

  if (infoChipPreviewUrn === urn && infoChipPreviewLayer && layerGroup.hasLayer(infoChipPreviewLayer)) {
    bindInfoChipPreviewState(chip, { isLoading: false, isActive: true });
    infoChipPreviewLayer.bringToFront();
    return;
  }

  clearInfoChipMapPreviewLayer();
  bindInfoChipPreviewState(chip, { isLoading: true, isActive: false });

  const geojsonData = await ensureInfoChipPreviewGeoJson(urn);
  if (requestToken !== infoChipPreviewRequestToken) return;
  if (activeInfoChipPreviewChipEl !== chip) return;
  if (isMapGeojsonPinned(urn)) {
    bindInfoChipPreviewState(chip, { isLoading: false, isActive: true });
    return;
  }

  const parsed = parseGeoJson(geojsonData);
  if (!parsed || !layerGroup) {
    bindInfoChipPreviewState(chip, { isLoading: false, isActive: false });
    return;
  }

  infoChipPreviewLayer = L.geoJSON(parsed, {
    style: { ...INFO_CHIP_PREVIEW_STYLE, className: 'plod-info-chip-preview' },
    interactive: false,
  }).addTo(layerGroup);
  infoChipPreviewLayer.bringToFront();
  infoChipPreviewUrn = urn;

  bindInfoChipPreviewState(chip, { isLoading: false, isActive: true });
}

function scheduleInfoChipMapPreviewClear(urn, chip) {
  if (chip) {
    bindInfoChipPreviewState(chip, { isLoading: false, isActive: false });
    if (activeInfoChipPreviewChipEl === chip) activeInfoChipPreviewChipEl = null;
  }

  if (isMapGeojsonPinned(urn)) return;

  clearInfoChipPreviewClearTimeout();
  const requestToken = ++infoChipPreviewRequestToken;
  infoChipPreviewClearTimeoutId = setTimeout(() => {
    infoChipPreviewClearTimeoutId = null;
    if (requestToken !== infoChipPreviewRequestToken) return;
    if (infoChipPreviewUrn !== urn) return;
    clearInfoChipMapPreviewLayer();
  }, INFO_CHIP_PREVIEW_CLEAR_DELAY_MS);
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

  const label = getDisplayLabelOrFallback(item.label, extractShortId(urn));
  const type = item.type ? extractShortId(item.type) : '';

  return {
    urn,
    label,
    type,
    geojson: item.geojson || null,
    canFetchChildren: item.canFetchChildren !== false,
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
    if (node.canFetchChildren === false) existing.canFetchChildren = false;
    return existing;
  }

  const cloned = { ...node };
  state.nodeMetaByUrn.set(node.urn, cloned);
  return cloned;
}

function recordHierarchyNodes(state, nodes) {
  return nodes.map(node => upsertHierarchyNode(state, node)).filter(Boolean);
}

function canHierarchyNodeFetchChildren(state, urn) {
  if (!state || !urn) return false;
  const node = state.nodeMetaByUrn.get(urn);
  if (!node) return false;
  if (node.canFetchChildren === false) return false;
  return state.profile === 'concept' || state.profile === 'spatial';
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
    checkingChildPresenceUrns: new Set(),
    childPresenceCheckedUrns: new Set(),
  };

  upsertHierarchyNode(state, currentNode);
  state.ancestors = recordHierarchyNodes(state, ancestors);
  const normalizedChildren = recordHierarchyNodes(state, children);
  state.childrenByParentUrn.set(currentNode.urn, normalizedChildren);
  state.childPresenceCheckedUrns.add(currentNode.urn);
  if (normalizedChildren.length) {
    state.leafUrns.delete(currentNode.urn);
  } else {
    state.leafUrns.add(currentNode.urn);
  }

  for (const node of normalizedChildren) {
    if (!node || !node.urn) continue;
    if (!canHierarchyNodeFetchChildren(state, node.urn)) {
      state.leafUrns.add(node.urn);
      state.childPresenceCheckedUrns.add(node.urn);
    }
  }

  queueHierarchyChildPresenceChecks(state, normalizedChildren);
  return state;
}

async function probeHierarchyNodeChildPresence(state, urn) {
  if (!state || !urn) return;
  if (hierarchyState !== state) return;
  if (state.childPresenceCheckedUrns.has(urn) || state.checkingChildPresenceUrns.has(urn)) return;

  if (!canHierarchyNodeFetchChildren(state, urn)) {
    state.childPresenceCheckedUrns.add(urn);
    state.leafUrns.add(urn);
    return;
  }

  if (state.childrenByParentUrn.has(urn)) {
    const knownChildren = state.childrenByParentUrn.get(urn) || [];
    state.childPresenceCheckedUrns.add(urn);
    if (knownChildren.length) {
      state.leafUrns.delete(urn);
    } else {
      state.leafUrns.add(urn);
    }
    return;
  }

  state.checkingChildPresenceUrns.add(urn);
  rerenderHierarchy();

  const children = state.profile === 'concept'
    ? await fetchConceptualHierarchyChildren(urn)
    : await fetchSpatialHierarchyChildren(urn);

  if (hierarchyState !== state) return;

  state.checkingChildPresenceUrns.delete(urn);
  state.childPresenceCheckedUrns.add(urn);

  if (Array.isArray(children) && children.length) {
    state.leafUrns.delete(urn);
  } else {
    state.leafUrns.add(urn);
  }

  rerenderHierarchy();
}

function queueHierarchyChildPresenceChecks(state, nodes) {
  if (!state || !Array.isArray(nodes) || !nodes.length) return;

  for (const node of nodes) {
    if (!node || !node.urn) continue;
    if (!canHierarchyNodeFetchChildren(state, node.urn)) continue;
    void probeHierarchyNodeChildPresence(state, node.urn);
  }
}

async function buildHierarchyState(profile, currentNode, options = {}) {
  if (!currentNode || !currentNode.urn) return null;
  const seedChildren = Array.isArray(options.seedChildren) ? options.seedChildren : [];

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
    const initialChildren = seedChildren.length ? seedChildren : children;
    return createHierarchyState('spatial', currentNode, ancestors, initialChildren);
  }

  return null;
}

function getHierarchySlot() {
  return getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER);
}

function canRenderHierarchyPinToggle(node) {
  return !!(node && node.urn);
}

function renderHierarchyNode(node, { kind = 'ancestor', previewUrn = '' } = {}) {
  const typeHtml = node.type ? `<span class="hierarchy-node-type">${escHtml(node.type)}</span>` : '';
  const pinHtml = canRenderHierarchyPinToggle(node)
    ? renderMapPinToggleButton({
        urn: node.urn,
        shortLabel: extractShortId(node.urn),
        contextClass: 'map-pin-toggle-hierarchy',
      })
    : '';
  const previewAttrs = previewUrn
    ? ` data-hierarchy-preview="${escAttr(previewUrn)}" tabindex="0"`
    : '';
  const previewClass = previewUrn ? ' hierarchy-node-preview' : '';

  return `<div class="hierarchy-node hierarchy-node-${kind}${previewClass}"${previewAttrs}>` +
         `<span class="hierarchy-node-main">` +
         `<span class="hierarchy-node-label">${escHtml(node.label)}</span>${typeHtml}</span>` +
         `<span class="hierarchy-node-actions">${pinHtml}` +
         `<button type="button" class="hierarchy-go" data-hierarchy-go="${escAttr(node.urn)}" aria-label="Go to ${escAttr(extractShortId(node.urn))}" title="Go to ${escAttr(extractShortId(node.urn))}">↗</button>` +
         `</span>` +
         `</div>`;
}

function renderHierarchyLine(node, kind = 'ancestor') {
  return renderHierarchyNode(node, { kind });
}

function renderHierarchyBranch(node, state) {
  const children = state.childrenByParentUrn.get(node.urn) || [];
  const isExpanded = state.expandedUrns.has(node.urn);
  const isLoading = state.loadingUrns.has(node.urn);
  const isLeaf = state.leafUrns.has(node.urn);
  const isCheckingChildPresence = state.checkingChildPresenceUrns.has(node.urn);

  let toggleHtml = '<span class="hierarchy-toggle hierarchy-toggle-spacer"></span>';
  if (isLoading || isCheckingChildPresence) {
    toggleHtml = '<span class="hierarchy-toggle hierarchy-toggle-loading">…</span>';
  } else if (!isLeaf) {
    toggleHtml = `<button type="button" class="hierarchy-toggle" data-hierarchy-toggle="${escAttr(node.urn)}" aria-label="Toggle descendants">${isExpanded && children.length ? '−' : '+'}</button>`;
  }

  const nestedHtml = isExpanded && children.length
    ? `<ul class="hierarchy-children">${children.map(child => renderHierarchyBranch(child, state)).join('')}</ul>`
    : '';

  return `<li class="hierarchy-item">` +
         `<div class="hierarchy-row">${toggleHtml}` +
         renderHierarchyNode(node, { kind: 'child', previewUrn: node.urn }) +
         `</div>${nestedHtml}</li>`;
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
  if (isMapGeojsonPinned(urn)) return;
  if (hierarchyPreviewUrn === urn) return;

  clearHierarchyPreview();
  const requestToken = hierarchyPreviewRequestToken;
  const geojsonData = await ensureHierarchyNodeGeojson(urn);
  if (requestToken !== hierarchyPreviewRequestToken) return;
  if (isMapGeojsonPinned(urn)) return;

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
  if (isMapGeojsonPinned(urn)) return;
  if (hierarchyPreviewUrn !== urn) return;
  clearHierarchyPreview();
}

async function toggleHierarchyNode(urn) {
  if (!hierarchyState || !urn) return;

  const state = hierarchyState;
  if (!canHierarchyNodeFetchChildren(state, urn)) {
    state.leafUrns.add(urn);
    state.childPresenceCheckedUrns.add(urn);
    rerenderHierarchy();
    return;
  }

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
  state.childPresenceCheckedUrns.add(urn);
  if (normalizedChildren.length) {
    state.leafUrns.delete(urn);
    state.expandedUrns.add(urn);
    queueHierarchyChildPresenceChecks(state, normalizedChildren);
  } else {
    state.leafUrns.add(urn);
  }
  rerenderHierarchy();
}

function wireHierarchyInteractions(slotEl) {
  if (!slotEl) return;

  bindMapPinToggleButtons(slotEl);

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

async function renderInfo(triples, el, shortId = '', resourceProfile = 'default', entityUrn = '') {
  if (!el) return;

  if (!Object.keys(triples).length) {
    el.innerHTML = '<p class="placeholder">No information available.</p>';
    return;
  }

  const rawLabel = (triples['http://www.w3.org/2000/01/rdf-schema#label'] || [])[0] || '';
  const label   = getDisplayLabelOrFallback(rawLabel, shortId);
  const typeUrn = (triples['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'] || [])[0] || '';
  const chipSectionConfigs = getInfoChipSectionConfigs(shortId, resourceProfile, typeUrn, entityUrn);
  const suppressedPredicateTails = getInfoChipSuppressedPredicateTails(chipSectionConfigs);

  let html = '';
  html += `<p class="entity-title">${escHtml(label)}</p>`;
  if (typeUrn) html += `<p class="entity-type">${escHtml(extractShortId(typeUrn))}</p>`;

  const externalLinks = collectExternalLinks(triples);
  if (externalLinks.length) {
    html += '<div class="info-external-links-row">' +
      '<span class="info-external-links-label">Links</span>' +
      '<span class="info-external-links">' +
      externalLinks.map(link =>
        `<a class="info-external-link" href="${escAttr(link.url)}" target="_blank" rel="noopener noreferrer" title="${escAttr(link.title)}" aria-label="${escAttr(link.label)}">${escHtml(link.icon)}</a>`
      ).join('') +
      '</span></div>';
  }

  html += chipSectionConfigs.map(renderInfoEntityRowLoading).join('');

  html += '<table><tbody>';
  for (const [pred, vals] of Object.entries(triples)) {
    if (SKIP_PREDICATES.has(pred) || isExternalLinkPredicate(pred)) continue;
    if (suppressedPredicateTails.has(getPredicateTail(pred))) continue;
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

  // Avoid stale async updates if the user navigated while relationship fetches were in flight.
  if (entityUrn && document.getElementById('current-id')?.textContent !== entityUrn) return;

  el.innerHTML = html;

  bindInfoNavigationEvents(el);
  bindInfoExternalLinkPreviewEvents(el);
  bindMapPinToggleButtons(el);
  loadInfoChipSectionsAsync({
    containerEl: el,
    shortId,
    resourceProfile,
    resourceTypeUrn: typeUrn,
    entityUrn,
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

function renderImages(images, el, contextEntityUrn = '') {
  if (!el) return;

  if (!images || !images.length) {
    el.innerHTML = '<p class="placeholder">No images available.</p>';
    return;
  }

  el.innerHTML = '<p class="loading">Loading images…</p>';

  // Build feature URN lookup before resolving URLs (resolveImageUrl discards the feature field)
  const featureByUrn = new Map();
  const entityByUrn = new Map();
  const captionByUrn = new Map();
  for (const img of images) {
    if (img && img.urn && img.feature) featureByUrn.set(img.urn, img.feature);
    if (img && img.urn && img.entity) entityByUrn.set(img.urn, img.entity);
    if (img && img.urn) captionByUrn.set(img.urn, normalizeImageModalCaption(img.l_description || img.x_luna_description || ''));
  }

  Promise.all(images.map(resolveImageUrl)).then(results => {
    if (contextEntityUrn && document.getElementById('current-id')?.textContent !== contextEntityUrn) return;
    const valid = results.filter(Boolean);
    if (!valid.length) {
      el.innerHTML = '<p class="placeholder">No images available.</p>';
      return;
    }

    let html = '<div class="image-grid">';
    for (const { urn, url } of valid) {
      const short = extractShortId(urn);
      const featureUrn = featureByUrn.get(urn) || '';
      const entityUrn = entityByUrn.get(urn) || contextEntityUrn;
      const caption = captionByUrn.get(urn) || '';
      const featureAttr = featureUrn ? ` data-feature-urn="${escAttr(featureUrn)}"` : '';
      const entityAttr = entityUrn && !featureUrn ? ` data-entity-urn="${escAttr(entityUrn)}"` : '';
      const captionAttr = caption ? ` data-image-caption="${escAttr(caption)}"` : '';
      if (url) {
        html += `<a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer" data-image-url="${escAttr(url)}" data-image-urn="${escAttr(urn)}"${featureAttr}${entityAttr}${captionAttr}>` +
                `<img src="${escAttr(url)}" alt="${escAttr(short)}" title="${escAttr(short)}" loading="lazy">` +
                `</a>`;
      } else {
        html += `<div class="image-urn-fallback"${featureAttr}${entityAttr}${captionAttr} title="${escAttr(urn)}">${escHtml(short)}</div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
    invalidateImageModalSequence();
    wireSpatialImageHoverEvents(el);
    wireImageHoverEvents(el);
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

  if (layersByEntityUrn.has(featureUrn)) {
    spatialHoverCache.set(featureUrn, featureUrn);
    return featureUrn;
  }

  // Direct mapping fallback when feature identity differs from registered layer URN.
  if (mapFeatureOwnerUrnByFeatureUrn.has(featureUrn)) {
    const ownerUrn = mapFeatureOwnerUrnByFeatureUrn.get(featureUrn) || null;
    spatialHoverCache.set(featureUrn, ownerUrn);
    return ownerUrn;
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

function renderConceptImages(depictedItems, el, bestImageUrns = [], contextEntityUrn = '') {
  if (!el) return;

  const items = depictedItems || [];
  if (!items.length && !bestImageUrns.length) {
    el.innerHTML = '<p class="placeholder">No images available.</p>';
    return;
  }

  el.innerHTML = '<p class="loading">Loading images…</p>';

  const cards = [];
  const seenImageUrns = new Set();

  for (const imageUrn of bestImageUrns) {
    const urn = String(imageUrn || '').trim();
    if (!urn || seenImageUrns.has(urn)) continue;
    seenImageUrns.add(urn);

    const matchingItem = items.find(item => {
      const itemImageUrn = String(item.best_image || item.urn || '').trim();
      return itemImageUrn === urn;
    });

    cards.push({
      imageUrn: urn,
      entityUrn: String((matchingItem && matchingItem.urn) || contextEntityUrn || '').trim(),
      url: matchingItem ? (matchingItem.l_img_url || null) : null,
      caption: normalizeImageModalCaption((matchingItem && (matchingItem.l_description || matchingItem.x_luna_description)) || ''),
    });
  }

  for (const item of items) {
    const entityUrn = String(item.urn || '').trim();
    const imageUrn = String(item.best_image || entityUrn).trim();
    if (!imageUrn || seenImageUrns.has(imageUrn)) continue;
    seenImageUrns.add(imageUrn);

    cards.push({
      imageUrn,
      entityUrn,
      url: item.l_img_url || null,
      caption: normalizeImageModalCaption(item.l_description || item.x_luna_description || ''),
    });
  }

  Promise.all(cards.map(async card => {
    if (card.url) return card;
    const resolved = await resolveImageUrl(card.imageUrn);
    return {
      ...card,
      url: (resolved && resolved.url) || null,
    };
  })).then(resolvedCards => {
    if (contextEntityUrn && document.getElementById('current-id')?.textContent !== contextEntityUrn) return;

    let html = '<div class="image-grid">';
    for (const card of resolvedCards) {
      const imageUrn = card.imageUrn;
      const entityUrn = card.entityUrn || contextEntityUrn;
      const short = extractShortId(imageUrn || entityUrn);
      const captionAttr = card.caption ? ` data-image-caption="${escAttr(card.caption)}"` : '';
      const entityAttr = entityUrn ? ` data-entity-urn="${escAttr(entityUrn)}"` : '';

      if (card.url) {
        html += `<a href="${escAttr(card.url)}" target="_blank" rel="noopener noreferrer" data-image-url="${escAttr(card.url)}" data-image-urn="${escAttr(imageUrn)}"${entityAttr}${captionAttr}>` +
                `<img src="${escAttr(card.url)}" alt="${escAttr(short)}" title="${escAttr(short)}" loading="lazy">` +
                `</a>`;
      } else {
        html += `<div class="image-urn-fallback" data-image-urn="${escAttr(imageUrn)}"${entityAttr}${captionAttr} title="${escAttr(imageUrn || entityUrn)}">${escHtml(short)}</div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
    invalidateImageModalSequence();
    wireImageHoverEvents(el);
    wireImageModalOpenEvents(el);
  });
}

// ── Panel: Map ────────────────────────────────────────────────────────────────

function addGeoJsonLayer(item, styleOpts, clickable) {
  const fallbackUrn = item && item.urn ? item.urn : '';
  const normalizedFeatures = normalizeGeoJsonFeatures(item && item.geojson, { fallbackUrn });
  if (!normalizedFeatures.length || !layerGroup) return null;

  const featureLayers = [];
  const hoverUrn = fallbackUrn || (normalizedFeatures[0] && normalizedFeatures[0].featureUrn) || '';
  const aggregateLabel = getDisplayLabelOrFallback(item && item.label, extractShortId(hoverUrn));
  const shouldPreferFeatureUrnOnClick = clickable && normalizedFeatures.length > 1;

  const getFeatureDisplayLabel = normalizedFeature => {
    const props = normalizedFeature && normalizedFeature.featureGeoJson && normalizedFeature.featureGeoJson.properties
      ? normalizedFeature.featureGeoJson.properties
      : null;

    const featureLabel = props
      ? getDisplayLabelOrFallback(props.label || props.title || props.name || '', '')
      : '';
    if (featureLabel) {
      if (featureLabel.startsWith('urn:p-lod:id:')) return extractShortId(featureLabel);
      return featureLabel;
    }

    return getDisplayLabelOrFallback(aggregateLabel, extractShortId(normalizedFeature.featureUrn));
  };

  for (const normalizedFeature of normalizedFeatures) {
    const featureUrn = normalizedFeature.featureUrn;
    const featureGeoJson = normalizedFeature.featureGeoJson;
    const featureLabel = getFeatureDisplayLabel(normalizedFeature);

    geojsonFeaturePayloadByUrn.set(featureUrn, featureGeoJson);
    registerGeoJsonFeatureUrn(featureUrn, featureUrn);
    if (fallbackUrn) registerGeoJsonFeatureUrn(fallbackUrn, featureUrn);
    mapFeatureOwnerUrnByFeatureUrn.set(featureUrn, featureUrn);

    const featureLayer = L.geoJSON(featureGeoJson, {
      style: { ...styleOpts, className: clickable ? 'plod-clickable' : 'plod-static' },
      onEachFeature(_feature, lyr) {
        if (featureLabel) lyr.bindTooltip(featureLabel, { sticky: true });
        if (hoverUrn) {
          lyr.on('mouseover', () => {
            paneEvents.emit(PANE_EVENT_ENTITY_HIGHLIGHT, { urn: featureUrn, source: 'map' });
          });
          lyr.on('mouseout', () => {
            paneEvents.emit(PANE_EVENT_ENTITY_CLEAR, { urn: featureUrn, source: 'map' });
          });
        }
        if (clickable && item && item.urn) {
          const clickTargetUrn = shouldPreferFeatureUrnOnClick ? featureUrn : item.urn;
          lyr.on('click', () => navigate(clickTargetUrn));
        }
      },
    }).addTo(layerGroup);

    featureLayers.push(featureLayer);
    layersByEntityUrn.set(featureUrn, {
      layers: [featureLayer],
      boundsLayer: featureLayer,
      defaultStyle: { ...styleOpts },
    });
  }

  if (!featureLayers.length) return null;

  const boundsLayer = L.featureGroup(featureLayers);
  if (item && item.urn) {
    const existingEntry = layersByEntityUrn.get(item.urn);
    if (existingEntry) {
      existingEntry.layers.push(...featureLayers);
      existingEntry.boundsLayer = L.featureGroup(existingEntry.layers);
      return existingEntry.boundsLayer;
    }

    layersByEntityUrn.set(item.urn, {
      layers: featureLayers,
      boundsLayer,
      defaultStyle: { ...styleOpts },
    });
  }

  return boundsLayer;
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
      entry.layers.forEach(layer => layer.setStyle(HIGHLIGHT_STYLE));
    }

    const outOfView = isLayerOutOfView(entry.boundsLayer);
    if (source === 'image' && outOfView && !shouldPan && !isPanModifierDown()) {
      showMapFocusHint();
    }

    if (shouldPan || isPanModifierDown()) {
      panToLayerIfOutOfView(entry.boundsLayer);
    }

    if (source === 'map') {
      paneEvents.emit(PANE_EVENT_IMAGE_PREVIEW_REQUEST, { featureUrn: urn, source: 'map' });
    }

    hideActiveAncestorOutline();
    if (currentResourceProfile !== 'concept') return;

    void showAncestorOutlineForHoveredEntity(urn);
  });
  paneEvents.on(PANE_EVENT_ENTITY_CLEAR, ({ urn, source = null }) => {
    const entry = layersByEntityUrn.get(urn);
    if (!entry) return;

    cancelAttentionPulseForUrn(urn);
    if (currentHoveredEntityUrn === urn) currentHoveredEntityUrn = null;
    hideActiveAncestorOutline();
    entry.layers.forEach(layer => layer.setStyle(entry.defaultStyle));

    if (source === 'map') {
      paneEvents.emit(PANE_EVENT_IMAGE_PREVIEW_CLEAR, { featureUrn: urn, source: 'map' });
    }
  });

  paneEvents.on(PANE_EVENT_ENTITY_HIGHLIGHT, ({ urn, source }) => {
    if (source !== 'map' && source !== 'info') return;
    if (suppressMapToImageHighlight) return;
    const imageEl = highlightAndScrollToFirstAssociatedImage(urn);
    if (!imageEl) return;
    syncOpenImageModalFromEntityUrn(urn);
  });

  paneEvents.on(PANE_EVENT_ENTITY_CLEAR, ({ source }) => {
    if (source !== 'map' && source !== 'info') return;
    clearActiveMapHoverImage();
  });

  paneEvents.on(PANE_EVENT_IMAGE_PREVIEW_REQUEST, ({ featureUrn, source }) => {
    if (source !== 'map') return;
    requestImagePaneFeaturePreview(featureUrn);
  });

  paneEvents.on(PANE_EVENT_IMAGE_PREVIEW_CLEAR, ({ source }) => {
    if (source !== 'map') return;
    cancelImagePaneFeaturePreviewRequest();
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

async function fetchDepictedWhereAtDetailLevel(shortId, detailLevel) {
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
  const spaceItems = await fetchDepictedWhereAtDetailLevel(shortId, 'space');
  if (Array.isArray(spaceItems) && spaceItems.length > 0) {
    return { detailLevel: 'space', items: spaceItems };
  }

  const featureItems = await fetchDepictedWhereAtDetailLevel(shortId, 'feature');
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
  const rawLabel  = (triples['http://www.w3.org/2000/01/rdf-schema#label'] || [])[0] || '';
  const label     = getDisplayLabelOrFallback(rawLabel, shortId);
  const bestImageUrns = getBestImageUrnsFromTriples(triples);
  const resourceHandler = resolveResourceHandler(typeUrn);
  const isSpatial = resourceHandler.isSpatial;
  const selfGjStr = (triples['urn:p-lod:id:geojson'] || [])[0] || null;

  const resolved = resourceHandler.resolvePaneLayout(currentPaneLayoutOverride);
  currentResourceProfile = resolved.profile;
  applyPaneLayout(resolved.layout);

  void renderInfo(
    triples,
    getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.INFO),
    shortId,
    currentResourceProfile,
    id
  );
  renderHierarchyPlaceholder(
    getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.HIERARCHY_PLACEHOLDER),
    currentResourceProfile
  );

  const hierarchyProfile = resourceHandler.getHierarchyProfile();
  const currentHierarchyNode = {
    urn: id,
    label,
    type: extractShortId(typeUrn),
    geojson: selfGjStr,
  };

  // Step 2: parallel fetches — images (spatial only) + map/concept children + hierarchy
  const [imagesRes, mapRes, hierarchyRes] = await Promise.allSettled([
    resourceHandler.getImagesPromise(shortId),
    resourceHandler.getMapDataPromise(shortId),
    hierarchyProfile
      ? (async () => {
          const seedChildren = await resourceHandler.getHierarchySeedNodes(currentHierarchyNode);
          return buildHierarchyState(hierarchyProfile, currentHierarchyNode, { seedChildren });
        })()
      : Promise.resolve(null),
  ]);

  let childItems = [];
  let conceptDetailLevel = 'feature';
  if (mapRes.status === 'fulfilled') {
    const childData = resourceHandler.getChildItems(mapRes.value);
    childItems = childData.childItems;
    conceptDetailLevel = childData.conceptDetailLevel;
  }

  resourceHandler.renderImagesPane({
    bestImageUrns,
    imagesResult: imagesRes.status === 'fulfilled' ? imagesRes.value : null,
    childItems,
    slotEl: getPaneSlotForContent(currentPaneLayout, PANE_CONTENT_TYPES.IMAGES),
    entityUrn: id,
  });

  hierarchyState = hierarchyRes.status === 'fulfilled' ? hierarchyRes.value : null;
  rerenderHierarchy();

  // Build the self-boundary item for spatial entities
  let selfItem = await resourceHandler.buildSelfMapItem(id, shortId, shortId, selfGjStr);
  let mapChildItems = childItems;
  if (resourceHandler.promoteSelfGeometryToPrimaryLayer && selfItem) {
    mapChildItems = [selfItem, ...childItems];
    selfItem = null;
  }

  const mapPosition = getPanePositionForContent(currentPaneLayout, PANE_CONTENT_TYPES.MAP);
  const mapPaneEls = mapPosition ? getPaneElements(mapPosition) : null;
  renderMap(
    selfItem,
    mapChildItems,
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
