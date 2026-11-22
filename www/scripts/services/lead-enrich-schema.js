import { RUBRO_CATALOG } from './phase-engine.js';

const VALID_CONTACT_METHODS = ['whatsapp', 'instagram', 'llamada'];

const RUBRO_ALIASES = {
  gastronomia: 'gastronomia',
  gastronomia_y_alimentos: 'gastronomia',
  restaurante: 'gastronomia',
  cafeteria: 'gastronomia',
  pasteleria: 'gastronomia',
  panaderia: 'gastronomia',
  comida: 'gastronomia',
  barberia: 'barberia',
  belleza: 'barberia',
  peluqueria: 'barberia',
  salon: 'barberia',
  spa: 'barberia',
  veterinaria: 'veterinaria',
  mascotas: 'veterinaria',
  petshop: 'veterinaria',
  comercio: 'comercio',
  tienda: 'comercio',
  retail: 'comercio',
  minimarket: 'comercio',
  servicios: 'servicios',
  otros: 'servicios'
};

const KNOWN_RUBRO_KEYS = new Set(RUBRO_CATALOG.map((item) => item.key));

export function normalizeScore(rawScore) {
  if (rawScore === null || rawScore === undefined || rawScore === '') {
    return null;
  }
  const num = Number(String(rawScore).replace(',', '.'));
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(10, num));
  return Math.round(clamped * 10) / 10;
}

export function normalizeContactMethod(rawMethod) {
  if (!rawMethod) {
    return '';
  }
  const clean = String(rawMethod).trim().toLowerCase();
  if (['wa', 'wsp', 'whatsapp'].includes(clean)) {
    return 'whatsapp';
  }
  if (['ig', 'insta', 'instagram', 'instagram dm', 'dm'].includes(clean)) {
    return 'instagram';
  }
  if (['tel', 'tlf', 'phone', 'llamada', 'call', 'telefono', 'teléfono'].includes(clean)) {
    return 'llamada';
  }
  return VALID_CONTACT_METHODS.includes(clean) ? clean : '';
}

export function normalizeRubro(rawRubro) {
  if (!rawRubro) {
    return '';
  }
  const clean = String(rawRubro)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
  if (KNOWN_RUBRO_KEYS.has(clean)) {
    return clean;
  }
  if (RUBRO_ALIASES[clean]) {
    return RUBRO_ALIASES[clean];
  }
  return clean;
}

export function normalizeNoteKey(rawText) {
  if (!rawText) {
    return '';
  }
  let clean = String(rawText).trim();
  clean = clean.replace(/^(?:\[\d{2,4}[/-]\d{2}(?:[/-]\d{2,4})?(?:\s+\d{2}:\d{2})?\]\s*)+/g, '');
  clean = clean.replace(/\s+/g, ' ').trim().toLowerCase();
  return clean;
}

export function isDuplicateNote(existingNotes, newText) {
  const targetKey = normalizeNoteKey(newText);
  if (!targetKey) {
    return true;
  }
  const list = Array.isArray(existingNotes) ? existingNotes : [];
  return list.some((item) => {
    const itemText = item && typeof item === 'object' ? item.text : item;
    return normalizeNoteKey(itemText) === targetKey;
  });
}

export function applyRawEnrichFields(targetState, raw, normScoreFn, normMethodFn) {
  if (!(targetState && raw && typeof raw === 'object')) { return; }
  const rawMethod = raw.contactMethod !== undefined ? raw.contactMethod : (raw.contact_method !== undefined ? raw.contact_method : raw.recommendedChannel);
  if (rawMethod) { targetState.contactMethod = normMethodFn(rawMethod); }
  if (raw.score !== undefined) { targetState.score = normScoreFn(raw.score); }
  if (raw.suggestedMessage) { targetState.suggestedMessage = String(raw.suggestedMessage).trim(); }
  if (Array.isArray(raw.interestTags)) { targetState.interestTags = raw.interestTags; }
  if (Array.isArray(raw.quickNotes)) { targetState.quickNotes = raw.quickNotes; }
}

export function dedupeQuickNotes(rawNotes) {
  if (!Array.isArray(rawNotes)) {
    return [];
  }
  const seenKeys = new Set();
  const result = [];
  rawNotes.forEach((item) => {
    if (!item || !item.text) {
      return;
    }
    const cleanText = String(item.text).trim();
    const key = normalizeNoteKey(cleanText);
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    result.push(Object.assign({}, item, { text: cleanText }));
  });
  return result;
}
