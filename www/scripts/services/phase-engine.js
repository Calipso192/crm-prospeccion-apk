import { parseReminderParts } from './reminder-service.js';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const PHASE_2_MS = 3 * DAY_MS;
const PHASE_3_MS = 4 * DAY_MS;
const DISCARD_MS = 24 * HOUR_MS;
const INTEREST_CATALOG_KEY = 'crm_prospeccion_interest_tags_v2';

export const DEFAULT_INTEREST_TAGS = [
  { id: 'int_caliente', label: 'En caliente', tone: 'hot' },
  { id: 'int_demo', label: 'Pidió demo', tone: 'demo' },
  { id: 'int_negociando', label: 'Negociando', tone: 'negotiating' },
  { id: 'int_ia', label: 'Respondió IA', tone: 'ai' },
  { id: 'int_cotizado', label: 'Cotizado', tone: 'quoted' },
  { id: 'int_dueno', label: 'Hablar con dueño', tone: 'owner' }
];

export const INTEREST_TONES = [
  { key: 'hot', label: 'Rojo (Caliente)' },
  { key: 'demo', label: 'Celeste (Demo)' },
  { key: 'negotiating', label: 'Ámbar (Negociando)' },
  { key: 'ai', label: 'Morado (IA / Bot)' },
  { key: 'quoted', label: 'Verde (Cotizado)' },
  { key: 'owner', label: 'Naranja (Dueño)' }
];

export const RUBRO_CATALOG = [
  { key: 'gastronomia', label: 'Gastronomía' },
  { key: 'barberia', label: 'Barbería y Belleza' },
  { key: 'veterinaria', label: 'Veterinaria y Mascotas' },
  { key: 'comercio', label: 'Tienda y Comercio' },
  { key: 'servicios', label: 'Servicios y Otros' }
];

export const RETROACTIVE_DAYS = [
  { daysAgo: 0, label: 'Hoy' },
  { daysAgo: 3, label: 'Hace 3 días' },
  { daysAgo: 4, label: 'Hace 4 días' },
  { daysAgo: 7, label: 'Hace 7 días' }
];

export function getInterestTagsCatalog() {
  try {
    const raw = localStorage.getItem(INTEREST_CATALOG_KEY);
    if (!raw) {
      localStorage.setItem(INTEREST_CATALOG_KEY, JSON.stringify(DEFAULT_INTEREST_TAGS));
      return DEFAULT_INTEREST_TAGS.slice();
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item) => ({
        id: String(item.id),
        label: item.label ? String(item.label).trim() : 'Etiqueta',
        tone: item.tone ? String(item.tone).trim() : 'hot'
      }));
    }
    return DEFAULT_INTEREST_TAGS.slice();
  } catch (error) {
    return DEFAULT_INTEREST_TAGS.slice();
  }
}

function saveInterestTagsCatalog(list) {
  localStorage.setItem(INTEREST_CATALOG_KEY, JSON.stringify(list));
}

export function addInterestTagDefinition(label, tone) {
  const cleanLabel = label ? String(label).trim() : '';
  if (!cleanLabel) {
    throw new Error('Escribe un nombre para la etiqueta de interés.');
  }
  const catalog = getInterestTagsCatalog();
  const newItem = {
    id: 'int_' + Date.now(),
    label: cleanLabel,
    tone: tone ? String(tone).trim() : 'hot'
  };
  catalog.push(newItem);
  saveInterestTagsCatalog(catalog);
  return newItem;
}

export function updateInterestTagDefinition(id, label, tone) {
  const cleanLabel = label ? String(label).trim() : '';
  if (!cleanLabel) {
    throw new Error('El nombre de la etiqueta no puede quedar vacío.');
  }
  const catalog = getInterestTagsCatalog().map((item) => {
    if (item.id === id) {
      return { id: item.id, label: cleanLabel, tone: tone ? String(tone).trim() : item.tone };
    }
    return item;
  });
  saveInterestTagsCatalog(catalog);
}

export function deleteInterestTagDefinition(id) {
  const catalog = getInterestTagsCatalog().filter((item) => item.id !== id);
  saveInterestTagsCatalog(catalog);
}

export function computeRetroactiveTimestamp(daysAgo) {
  const cleanDays = Number(daysAgo) > 0 ? Number(daysAgo) : 0;
  return Date.now() - (cleanDays * DAY_MS);
}

function getLatestSentTag(sentTags) {
  if (!Array.isArray(sentTags) ? true : sentTags.length === 0) {
    return null;
  }
  let latest = sentTags[0];
  for (let i = 1; i < sentTags.length; i += 1) {
    if (Number(sentTags[i].sentAt) > Number(latest.sentAt)) {
      latest = sentTags[i];
    }
  }
  return latest;
}

export function evaluateLeadPhase(lead, nowMs) {
  const now = nowMs ? nowMs : Date.now();
  const status = lead.status ? lead.status : 'nuevo';
  const tags = Array.isArray(lead.sentTags) ? lead.sentTags : [];
  const tagCount = tags.length;

  if (status === 'nuevo') {
    return { phaseCode: 'nuevo_pendiente', phaseNumber: 0, suggestedPhase: 1, isActionDue: true, badgeText: 'Listo Fase 1', detailText: 'Pendiente 1er mensaje' };
  }
  if (status !== 'contactado') {
    return { phaseCode: 'none', phaseNumber: tagCount, suggestedPhase: 0, isActionDue: false, badgeText: '', detailText: '' };
  }
  if (tagCount === 0) {
    return { phaseCode: 'fase_1_pendiente', phaseNumber: 0, suggestedPhase: 1, isActionDue: true, badgeText: 'Sin toque · Fase 1', detailText: 'Enviar 1er mensaje' };
  }

  const lastTag = getLatestSentTag(tags);
  const elapsedMs = Math.max(0, now - Number(lastTag.sentAt));
  const daysElapsed = Math.floor(elapsedMs / DAY_MS);
  const hoursElapsed = Math.floor(elapsedMs / HOUR_MS);

  if (tagCount === 1) {
    if (elapsedMs >= PHASE_2_MS) {
      return { phaseCode: 'listo_fase_2', phaseNumber: 1, suggestedPhase: 2, isActionDue: true, badgeText: 'Listo Fase 2', detailText: 'Hace ' + daysElapsed + 'd desde Fase 1' };
    }
    const remDays = Math.max(1, Math.ceil((PHASE_2_MS - elapsedMs) / DAY_MS));
    return { phaseCode: 'espera_fase_1', phaseNumber: 1, suggestedPhase: 2, isActionDue: false, badgeText: 'Fase 1 · ' + daysElapsed + 'd', detailText: 'Fase 2 en ' + remDays + 'd' };
  }
  if (tagCount === 2) {
    if (elapsedMs >= PHASE_3_MS) {
      return { phaseCode: 'listo_fase_3', phaseNumber: 2, suggestedPhase: 3, isActionDue: true, badgeText: 'Listo Fase 3', detailText: 'Hace ' + daysElapsed + 'd desde Fase 2' };
    }
    const remDays = Math.max(1, Math.ceil((PHASE_3_MS - elapsedMs) / DAY_MS));
    return { phaseCode: 'espera_fase_2', phaseNumber: 2, suggestedPhase: 3, isActionDue: false, badgeText: 'Fase 2 · ' + daysElapsed + 'd', detailText: 'Fase 3 en ' + remDays + 'd' };
  }
  if (elapsedMs >= DISCARD_MS) {
    return { phaseCode: 'listo_descartar', phaseNumber: 3, suggestedPhase: 0, isActionDue: true, badgeText: 'Listo Descartar', detailText: '+' + hoursElapsed + 'h tras Fase 3' };
  }
  const remHours = Math.max(1, Math.ceil((DISCARD_MS - elapsedMs) / HOUR_MS));
  return { phaseCode: 'espera_fase_3', phaseNumber: 3, suggestedPhase: 0, isActionDue: false, badgeText: 'Fase 3 · ' + hoursElapsed + 'h', detailText: 'Descarte en ' + remHours + 'h' };
}

function getLocalDayKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

export function evaluateReminderUrgency(lead, nowMs) {
  const now = nowMs ? nowMs : Date.now();
  const parsed = parseReminderParts(lead.reminderAt);
  if (!parsed) {
    return { level: 'unscheduled', rank: 3, timestamp: Number.MAX_SAFE_INTEGER };
  }
  const targetMs = parsed.dateObj.getTime();
  if (targetMs < now) {
    return { level: 'overdue', rank: 0, timestamp: targetMs };
  }
  if (parsed.dateStr === getLocalDayKey(new Date(now))) {
    return { level: 'today', rank: 1, timestamp: targetMs };
  }
  return { level: 'upcoming', rank: 2, timestamp: targetMs };
}

export function sortSeguimientoLeads(leads, nowMs) {
  const now = nowMs ? nowMs : Date.now();
  return leads.slice().sort((a, b) => {
    const urgA = evaluateReminderUrgency(a, now);
    const urgB = evaluateReminderUrgency(b, now);
    if (urgA.rank !== urgB.rank) { return urgA.rank - urgB.rank; }
    if (urgA.rank < 3) { return urgA.timestamp - urgB.timestamp; }
    return Number(b.lastContactAt) - Number(a.lastContactAt);
  });
}

export function buildDashboardSnapshot(leads, nowMs) {
  const now = nowMs ? nowMs : Date.now();
  const interestCatalog = getInterestTagsCatalog();
  const queue = { seguimientoUrgent: 0, seguimientoOverdue: 0, seguimientoToday: 0, nuevosSinFase1: 0, listosFase2: 0, listosFase3: 0, listosDescartar: 0 };
  const funnel = { total: leads.length, nuevo: 0, contactadoF1: 0, contactadoF2: 0, contactadoF3: 0, contactadoTotal: 0, seguimiento: 0, vendido: 0, descartado: 0, sinWhatsapp: 0 };
  const interestCounts = {};
  interestCatalog.forEach((t) => { interestCounts[t.id] = 0; });

  const rubroMap = {};
  RUBRO_CATALOG.forEach((r) => { rubroMap[r.key] = { key: r.key, label: r.label, total: 0, responded: 0, sold: 0, revenue: 0 }; });
  rubroMap.otros = { key: '', label: 'Sin rubro', total: 0, responded: 0, sold: 0, revenue: 0 };

  let totalRevenue = 0;
  let contactedOrProgressed = 0;
  let respondedCount = 0;

  leads.forEach((lead) => {
    const st = lead.status ? lead.status : 'nuevo';
    const rKey = lead.rubro && rubroMap[lead.rubro] ? lead.rubro : 'otros';
    rubroMap[rKey].total += 1;

    if (Array.isArray(lead.interestTags)) {
      lead.interestTags.forEach((it) => {
        if (typeof interestCounts[it.id] === 'number') { interestCounts[it.id] += 1; }
      });
    }

    if (st === 'nuevo') { funnel.nuevo += 1; queue.nuevosSinFase1 += 1; return; }
    if (st === 'sin_whatsapp') { funnel.sinWhatsapp += 1; return; }
    contactedOrProgressed += 1;

    if (st === 'contactado') {
      funnel.contactadoTotal += 1;
      const phase = evaluateLeadPhase(lead, now);
      if (phase.phaseNumber <= 1) { funnel.contactadoF1 += 1; } else if (phase.phaseNumber === 2) { funnel.contactadoF2 += 1; } else { funnel.contactadoF3 += 1; }
      if (phase.phaseCode === 'listo_fase_2') { queue.listosFase2 += 1; }
      if (phase.phaseCode === 'listo_fase_3') { queue.listosFase3 += 1; }
      if (phase.phaseCode === 'listo_descartar') { queue.listosDescartar += 1; }
      return;
    }
    if (st === 'seguimiento') {
      funnel.seguimiento += 1;
      respondedCount += 1;
      rubroMap[rKey].responded += 1;
      const urg = evaluateReminderUrgency(lead, now);
      if (urg.level === 'overdue') { queue.seguimientoOverdue += 1; queue.seguimientoUrgent += 1; } else if (urg.level === 'today') { queue.seguimientoToday += 1; queue.seguimientoUrgent += 1; }
      return;
    }
    if (st === 'vendido') {
      funnel.vendido += 1;
      respondedCount += 1;
      rubroMap[rKey].responded += 1;
      rubroMap[rKey].sold += 1;
      const amt = Number(lead.saleAmount) > 0 ? Number(lead.saleAmount) : 0;
      totalRevenue += amt;
      rubroMap[rKey].revenue += amt;
      return;
    }
    if (st === 'descartado') { funnel.descartado += 1; }
  });

  const rubroStats = RUBRO_CATALOG.map((r) => {
    const item = rubroMap[r.key];
    item.conversionRate = item.total > 0 ? Math.round((item.sold / item.total) * 100) : 0;
    return item;
  });

  return {
    queue: queue,
    funnel: funnel,
    sales: {
      ventasCount: funnel.vendido,
      totalRevenue: totalRevenue,
      interestCatalog: interestCatalog,
      interestCounts: interestCounts,
      responseRate: contactedOrProgressed > 0 ? Math.round((respondedCount / contactedOrProgressed) * 100) : 0,
      closeRate: respondedCount > 0 ? Math.round((funnel.vendido / respondedCount) * 100) : 0
    },
    rubroStats: rubroStats
  };
}

export function matchesQueueFilter(lead, queueKey, nowMs) {
  if (!queueKey) { return true; }
  const now = nowMs ? nowMs : Date.now();
  const st = lead.status ? lead.status : 'nuevo';
  if (queueKey === 'seg_urgente') { return st === 'seguimiento' && evaluateReminderUrgency(lead, now).rank <= 1; }
  if (queueKey === 'nuevo_f1') { return st === 'nuevo'; }
  if (queueKey === 'listo_f2') { return st === 'contactado' && evaluateLeadPhase(lead, now).phaseCode === 'listo_fase_2'; }
  if (queueKey === 'listo_f3') { return st === 'contactado' && evaluateLeadPhase(lead, now).phaseCode === 'listo_fase_3'; }
  if (queueKey === 'listo_descartar') { return st === 'contactado' && evaluateLeadPhase(lead, now).phaseCode === 'listo_descartar'; }
  if (queueKey.startsWith('int_')) { return Array.isArray(lead.interestTags) && lead.interestTags.some((t) => t.id === queueKey); }
  return true;
}
