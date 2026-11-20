import { parseReminderParts } from './reminder-service.js';

const DAY_MS = 86400000;
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
    if (Array.isArray(parsed)) {
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
  const suffix = Math.random().toString(36).slice(2, 6);
  const newItem = {
    id: 'int_' + Date.now() + '_' + suffix,
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

function ingestInterestList(tagList, indexById, merged) {
  if (!Array.isArray(tagList)) {
    return 0;
  }
  let added = 0;
  tagList.forEach((tag) => {
    if (!(tag && tag.id)) {
      return;
    }
    const id = String(tag.id);
    if (!indexById.has(id)) {
      indexById.set(id, merged.length);
      merged.push({
        id: id,
        label: tag.label ? String(tag.label).trim() : id,
        tone: 'hot'
      });
      added += 1;
    }
  });
  return added;
}

export function mergeInterestTagsCatalog(incomingCatalog, incomingLeads) {
  const current = getInterestTagsCatalog();
  const defaultById = new Map(DEFAULT_INTEREST_TAGS.map((t) => [t.id, t]));
  const indexById = new Map(current.map((t, idx) => [t.id, idx]));
  const merged = current.slice();
  let added = 0;
  let updated = 0;

  if (Array.isArray(incomingCatalog)) {
    incomingCatalog.forEach((raw) => {
      if (!(raw && raw.id)) {
        return;
      }
      const inc = {
        id: String(raw.id),
        label: raw.label ? String(raw.label).trim() : 'Etiqueta',
        tone: raw.tone ? String(raw.tone).trim() : 'hot'
      };
      if (!indexById.has(inc.id)) {
        indexById.set(inc.id, merged.length);
        merged.push(inc);
        added += 1;
        return;
      }
      const idx = indexById.get(inc.id);
      const localItem = merged[idx];
      const defItem = defaultById.get(inc.id);
      if (defItem && localItem.label === defItem.label && localItem.tone === defItem.tone) {
        if (inc.label !== defItem.label ? true : inc.tone !== defItem.tone) {
          merged[idx] = inc;
          updated += 1;
        }
      }
    });
  }

  if (Array.isArray(incomingLeads)) {
    incomingLeads.forEach((lead) => {
      if (!(lead && typeof lead === 'object')) {
        return;
      }
      added += ingestInterestList(lead.interestTags, indexById, merged);
      if (lead.campaignStates && typeof lead.campaignStates === 'object') {
        Object.keys(lead.campaignStates).forEach((cid) => {
          const st = lead.campaignStates[cid];
          if (st) {
            added += ingestInterestList(st.interestTags, indexById, merged);
          }
        });
      }
    });
  }

  if (added + updated > 0) {
    saveInterestTagsCatalog(merged);
  }
  return { added: added, updated: updated };
}

export function computeRetroactiveTimestamp(daysAgo) {
  const cleanDays = Number(daysAgo) > 0 ? Number(daysAgo) : 0;
  return Date.now() - (cleanDays * DAY_MS);
}

export function evaluateLeadPhase(lead) {
  const status = lead && lead.stage ? lead.stage : (lead && lead.status ? lead.status : 'nuevo');
  if (status === 'nuevo') {
    return {
      phaseCode: 'nuevo_pendiente',
      phaseNumber: 0,
      suggestedPhase: 1,
      isActionDue: true,
      badgeText: 'Por contactar',
      detailText: '1er toque pendiente'
    };
  }
  if (status === 'contactado') {
    return {
      phaseCode: 'contactado_triage',
      phaseNumber: 1,
      suggestedPhase: 2,
      isActionDue: true,
      badgeText: 'En triage',
      detailText: 'Clasificar respuesta'
    };
  }
  if (status === 'sin_whatsapp') {
    return {
      phaseCode: 'sin_whatsapp',
      phaseNumber: 0,
      suggestedPhase: 1,
      isActionDue: false,
      badgeText: 'Sin WhatsApp',
      detailText: 'Usar IG o Llamada'
    };
  }
  return {
    phaseCode: 'none',
    phaseNumber: 0,
    suggestedPhase: 0,
    isActionDue: false,
    badgeText: '',
    detailText: ''
  };
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

export function buildDashboardSnapshot(campaignLeads, nowMs) {
  const leads = Array.isArray(campaignLeads) ? campaignLeads : [];
  const now = nowMs ? nowMs : Date.now();
  const interestCatalog = getInterestTagsCatalog();
  const queue = {
    seguimientoUrgent: 0,
    seguimientoOverdue: 0,
    seguimientoToday: 0,
    nuevosPendientes: 0,
    contactadosTriage: 0,
    sinWhatsappAlt: 0
  };
  const funnel = {
    total: leads.length,
    nuevo: 0,
    contactado: 0,
    contactadoWa: 0,
    contactadoIg: 0,
    contactadoCall: 0,
    seguimiento: 0,
    vendido: 0,
    descartado: 0,
    descartadoBotMeta: 0,
    sinWhatsapp: 0
  };
  const interestCounts = {};
  interestCatalog.forEach((t) => { interestCounts[t.id] = 0; });

  const rubroMap = {};
  RUBRO_CATALOG.forEach((r) => {
    rubroMap[r.key] = { key: r.key, label: r.label, total: 0, responded: 0, sold: 0, revenue: 0 };
  });
  rubroMap.otros = { key: '', label: 'Sin rubro', total: 0, responded: 0, sold: 0, revenue: 0 };

  let totalRevenue = 0;
  let contactedOrProgressed = 0;
  let respondedCount = 0;

  leads.forEach((lead) => {
    const st = lead.stage ? lead.stage : (lead.status ? lead.status : 'nuevo');
    const rKey = lead.rubro && rubroMap[lead.rubro] ? lead.rubro : 'otros';
    rubroMap[rKey].total += 1;

    if (Array.isArray(lead.interestTags)) {
      lead.interestTags.forEach((it) => {
        if (typeof interestCounts[it.id] === 'number') { interestCounts[it.id] += 1; }
      });
    }

    if (st === 'nuevo') {
      funnel.nuevo += 1;
      queue.nuevosPendientes += 1;
      return;
    }
    if (st === 'sin_whatsapp') {
      funnel.sinWhatsapp += 1;
      queue.sinWhatsappAlt += 1;
      return;
    }
    contactedOrProgressed += 1;

    if (st === 'contactado') {
      funnel.contactado += 1;
      queue.contactadosTriage += 1;
      if (lead.channelUsed === 'instagram') {
        funnel.contactadoIg += 1;
      } else if (lead.channelUsed === 'llamada') {
        funnel.contactadoCall += 1;
      } else {
        funnel.contactadoWa += 1;
      }
      return;
    }
    if (st === 'seguimiento') {
      funnel.seguimiento += 1;
      respondedCount += 1;
      rubroMap[rKey].responded += 1;
      const urg = evaluateReminderUrgency(lead, now);
      if (urg.level === 'overdue') {
        queue.seguimientoOverdue += 1;
        queue.seguimientoUrgent += 1;
      } else if (urg.level === 'today') {
        queue.seguimientoToday += 1;
        queue.seguimientoUrgent += 1;
      }
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
    if (st === 'descartado') {
      funnel.descartado += 1;
      if (lead.isMetaBot) {
        funnel.descartadoBotMeta += 1;
      }
    }
  });

  const rubroStats = RUBRO_CATALOG.map((r) => {
    const item = rubroMap[r.key];
    item.conversionRate = item.total > 0 ? Math.round((item.sold / item.total) * 100) : 0;
    return item;
  });
  if (rubroMap.otros.total > 0) {
    rubroMap.otros.conversionRate = Math.round((rubroMap.otros.sold / rubroMap.otros.total) * 100);
    rubroStats.push(rubroMap.otros);
  }

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
  const st = lead.stage ? lead.stage : (lead.status ? lead.status : 'nuevo');
  if (queueKey === 'seg_urgente') { return st === 'seguimiento' && evaluateReminderUrgency(lead, now).rank <= 1; }
  if (queueKey === 'nuevo_pendiente') { return st === 'nuevo'; }
  if (queueKey === 'contactado_triage') { return st === 'contactado'; }
  if (queueKey === 'sin_whatsapp_alt') { return st === 'sin_whatsapp'; }
  if (queueKey.startsWith('int_')) {
    return Array.isArray(lead.interestTags) && lead.interestTags.some((t) => t.id === queueKey);
  }
  return true;
}
