import { normalizePhone, normalizeInstagram, normalizeChannel, normalizeStatus } from './lead-schema.js';
import { normalizeScore, normalizeContactMethod, normalizeRubro } from './lead-enrich-schema.js';

const EXPLICIT_SEPARATORS = [' - ', ' – ', ' — ', '\t', ';', ',', ': '];

function mapChannelAlias(rawChannel) {
  if (!rawChannel) { return ''; }
  const clean = String(rawChannel).trim().toLowerCase();
  if (['wa', 'wsp', 'whatsapp'].includes(clean)) { return 'whatsapp'; }
  if (['ig', 'insta', 'instagram'].includes(clean)) { return 'instagram'; }
  if (['tel', 'tlf', 'phone', 'llamada', 'call'].includes(clean)) { return 'llamada'; }
  return normalizeChannel(clean);
}

function isInstagramToken(token) {
  const lower = token.trim().toLowerCase();
  if (lower.startsWith('@')) {
    return normalizeInstagram(lower).length >= 2;
  }
  const hasIgDomain = lower.indexOf('instagram.com/') !== -1 ? true : lower.indexOf('instagr.am/') !== -1;
  return hasIgDomain ? normalizeInstagram(lower).length >= 2 : false;
}

function isPhoneToken(token) {
  const clean = token.trim();
  if (!clean) { return false; }
  if (/[a-zA-Z]/.test(clean)) { return false; }
  return normalizePhone(clean).length >= 7;
}

function splitByKnownSeparators(line) {
  for (let i = 0; i < EXPLICIT_SEPARATORS.length; i += 1) {
    const sep = EXPLICIT_SEPARATORS[i];
    if (line.indexOf(sep) !== -1) {
      return line.split(sep).map((s) => s.trim()).filter((s) => s.length > 0);
    }
  }
  return null;
}

function hasValidChannelValues(phone, instagram) {
  return phone.length >= 7 ? true : instagram.length >= 2;
}

function extractLineParts(line) {
  const segments = splitByKnownSeparators(line);
  if (segments && segments.length >= 2) {
    let phone = '';
    let instagram = '';
    const nameParts = [];
    segments.forEach((seg) => {
      if (!instagram && isInstagramToken(seg)) {
        instagram = normalizeInstagram(seg);
        return;
      }
      if (!phone && isPhoneToken(seg)) {
        phone = normalizePhone(seg);
        return;
      }
      nameParts.push(seg);
    });
    const cleanName = nameParts.join(' - ').trim();
    if (cleanName && hasValidChannelValues(phone, instagram)) {
      return { name: cleanName, phone: phone, instagram: instagram };
    }
  }

  let working = line;
  let extractedIg = '';
  const igTail = working.match(/^(.*?)\s+(@[a-zA-Z0-9._]{2,})$/);
  if (igTail && igTail[1].trim()) {
    extractedIg = normalizeInstagram(igTail[2]);
    working = igTail[1].trim();
  }

  let extractedPhone = '';
  const phoneTail = working.match(/^(.*?)\s+(\+?\d[\d\s\-()]{6,}\d)$/);
  if (phoneTail && phoneTail[1].trim() && normalizePhone(phoneTail[2]).length >= 7) {
    extractedPhone = normalizePhone(phoneTail[2]);
    working = phoneTail[1].trim();
  }

  if (working && hasValidChannelValues(extractedPhone, extractedIg)) {
    return { name: working, phone: extractedPhone, instagram: extractedIg };
  }

  const dashIdx = line.lastIndexOf('-');
  if (dashIdx > 0) {
    const right = line.slice(dashIdx + 1).trim();
    const left = line.slice(0, dashIdx).trim();
    if (left && isInstagramToken(right)) {
      return { name: left, phone: '', instagram: normalizeInstagram(right) };
    }
    if (left && normalizePhone(right).length >= 7) {
      return { name: left, phone: normalizePhone(right), instagram: '' };
    }
  }
  return null;
}

function extractMetaSegments(rawLine) {
  const parts = String(rawLine).split('|').map((s) => s.trim()).filter((s) => s.length > 0);
  const contactPart = parts.length > 0 ? parts[0] : '';
  let channelUsed = '';
  const notes = [];

  for (let i = 1; i < parts.length; i += 1) {
    const seg = parts[i];
    const chanMatch = seg.match(/^canal\s*:\s*(.+)$/i);
    if (chanMatch) {
      channelUsed = mapChannelAlias(chanMatch[1]);
      continue;
    }
    const noteMatch = seg.match(/^notas?\s*:\s*(.+)$/i);
    if (noteMatch) {
      notes.push(noteMatch[1].trim());
      continue;
    }
    notes.push(seg);
  }

  return {
    contactPart: contactPart,
    channelUsed: channelUsed,
    baseNotes: notes.join(' · ').trim()
  };
}

export function parseNightBatchJson(rawJsonText, defaultRubro) {
  if (!rawJsonText) { return []; }
  let parsed;
  try {
    parsed = JSON.parse(String(rawJsonText).trim());
  } catch (err) {
    return [];
  }
  const fallbackRubro = defaultRubro
    ? String(defaultRubro).trim().toLowerCase()
    : (parsed && !Array.isArray(parsed) && parsed.defaultRubro ? String(parsed.defaultRubro).trim().toLowerCase() : '');
  const items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.leads) ? parsed.leads : []);
  const results = [];

  items.forEach((item) => {
    if (!item || typeof item !== 'object') { return; }
    const name = String(item.name || item.nombre || item.title || '').trim();
    const phone = normalizePhone(item.phone || item.telefono || item.tel || '');
    const instagram = normalizeInstagram(item.instagram || item.ig || '');
    if (!name || !hasValidChannelValues(phone, instagram)) { return; }
    const rubro = normalizeRubro(item.rubro ? item.rubro : fallbackRubro);
    const channelUsed = mapChannelAlias(item.channelUsed || item.channel || item.canal || item.suggestedChannel || '');
    const contactMethod = normalizeContactMethod(item.contactMethod || item.contact_method || item.recommendedChannel || item.canalRecomendado || channelUsed);
    const score = normalizeScore(item.score);
    const stage = normalizeStatus(item.stage || item.status || 'nuevo');
    const baseNotes = String(item.baseNotes || item.notes || '').trim();
    const singleNote = String(item.note || item.nota || '').trim();
    const quickNotes = Array.isArray(item.quickNotes) ? item.quickNotes.slice() : [];
    if (singleNote) {
      quickNotes.unshift({ text: singleNote, createdAt: Date.now() });
    }
    const interestTags = Array.isArray(item.interestTags)
      ? item.interestTags.map((t) => (typeof t === 'object' ? t : { id: 'int_' + String(t).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: String(t).trim() })).filter((t) => t.id && t.label)
      : [];
    results.push({
      name: name,
      phone: phone,
      instagram: instagram,
      rubro: rubro,
      stage: stage,
      score: score,
      contactMethod: contactMethod,
      channelUsed: channelUsed,
      suggestedMessage: item.suggestedMessage ? String(item.suggestedMessage).trim() : '',
      interestTags: interestTags,
      quickNotes: quickNotes,
      baseNotes: baseNotes
    });
  });

  return results;
}

export function parseBulkLeadsText(rawText, defaultRubro) {
  if (!rawText) { return []; }
  const trimmed = String(rawText).trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const jsonLeads = parseNightBatchJson(trimmed, defaultRubro);
    if (jsonLeads.length > 0) { return jsonLeads; }
  }

  const cleanRubro = defaultRubro ? String(defaultRubro).trim().toLowerCase() : '';
  const lines = String(rawText).split(/\r?\n/);
  const parsedLeads = [];

  lines.forEach((rawLine) => {
    let cleanLine = String(rawLine).trim();
    cleanLine = cleanLine.replace(/^\d+[.)\-]\s+/, '');
    cleanLine = cleanLine.replace(/^[\-*•]\s+/, '').trim();
    if (!cleanLine) { return; }

    const meta = extractMetaSegments(cleanLine);
    const parts = extractLineParts(meta.contactPart);
    if (!parts) { return; }

    const hasPhone = parts.phone.length >= 7;
    const hasIg = parts.instagram.length >= 2;
    if (parts.name && hasValidChannelValues(parts.phone, parts.instagram)) {
      parsedLeads.push({
        name: parts.name,
        phone: hasPhone ? parts.phone : '',
        instagram: hasIg ? parts.instagram : '',
        rubro: cleanRubro,
        stage: 'nuevo',
        channelUsed: meta.channelUsed,
        baseNotes: meta.baseNotes
      });
    }
  });

  return parsedLeads;
}
