const LEGACY_TEMPLATES_KEY = 'crm_prospeccion_templates_v1';
const TEMPLATES_KEY = 'crm_prospeccion_templates_v2';
const CAMPAIGNS_KEY = 'crm_prospeccion_campaigns_v2';
const ACTIVE_CAMPAIGN_KEY = 'crm_prospeccion_active_campaign_v2';
const DEFAULT_CAMPAIGN_ID = 'camp_default';

const RUBRO_TEXT_MAP = {
  gastronomia: 'gastronomía',
  barberia: 'barbería y belleza',
  veterinaria: 'veterinaria',
  comercio: 'comercio',
  servicios: 'servicios'
};

const DEFAULT_CAMPAIGNS = [
  {
    id: DEFAULT_CAMPAIGN_ID,
    name: 'Campaña Principal (FidelizaCard)',
    description: 'Prospección base de negocios locales',
    status: 'activa',
    closedAt: 0,
    createdAt: 1700000000000
  }
];

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_1',
    campaignId: DEFAULT_CAMPAIGN_ID,
    phase: 1,
    rubro: '',
    label: 'Primer contacto',
    text: 'Hola {nombre}, un gusto saludarte. Te escribo para presentarte una propuesta que puede ayudarte a fidelizar más clientes en tu negocio.'
  },
  {
    id: 'tpl_2',
    campaignId: DEFAULT_CAMPAIGN_ID,
    phase: 2,
    rubro: '',
    label: 'Seguimiento respuesta',
    text: 'Hola {nombre}, gracias por responder. ¿Te gustaría que te muestre cómo funciona una demo rápida adaptada a tu {rubro}?'
  },
  {
    id: 'tpl_3',
    campaignId: DEFAULT_CAMPAIGN_ID,
    phase: 3,
    rubro: '',
    label: 'Envío de demo',
    text: 'Hola {nombre}, te comparto por aquí los detalles y la demostración para implementarlo en tu local. Quedo atento a tus dudas.'
  }
];

function shortRand() {
  return Math.random().toString(36).slice(2, 6);
}

function normalizeCampaignItem(item) {
  const src = item && typeof item === 'object' ? item : {};
  const rawStatus = src.status ? String(src.status).trim().toLowerCase() : 'activa';
  const cleanStatus = rawStatus === 'cerrada' ? 'cerrada' : 'activa';
  const closedAt = cleanStatus === 'cerrada' && Number(src.closedAt) > 0 ? Number(src.closedAt) : 0;
  return {
    id: src.id ? String(src.id) : DEFAULT_CAMPAIGN_ID,
    name: src.name ? String(src.name).trim() : 'Campaña',
    description: src.description ? String(src.description).trim() : '',
    status: cleanStatus,
    closedAt: closedAt,
    createdAt: Number(src.createdAt) > 0 ? Number(src.createdAt) : Date.now()
  };
}

function normalizeTemplateItem(item) {
  const cleanPhase = Number(item.phase);
  const validPhase = cleanPhase === 1 ? 1 : (cleanPhase === 2 ? 2 : (cleanPhase === 3 ? 3 : 0));
  return {
    id: String(item.id),
    campaignId: item.campaignId ? String(item.campaignId) : DEFAULT_CAMPAIGN_ID,
    phase: validPhase,
    rubro: item.rubro ? String(item.rubro).trim().toLowerCase() : '',
    label: item.label ? String(item.label).trim() : 'Mensaje',
    text: item.text ? String(item.text).trim() : ''
  };
}

function templatesEqual(a, b) {
  return a.campaignId === b.campaignId &&
    a.phase === b.phase &&
    a.rubro === b.rubro &&
    a.label === b.label &&
    a.text === b.text;
}

export function getCampaigns() {
  try {
    const raw = localStorage.getItem(CAMPAIGNS_KEY);
    if (!raw) {
      localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(DEFAULT_CAMPAIGNS));
      return DEFAULT_CAMPAIGNS.map(normalizeCampaignItem);
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(normalizeCampaignItem);
    }
    return DEFAULT_CAMPAIGNS.map(normalizeCampaignItem);
  } catch (error) {
    return DEFAULT_CAMPAIGNS.map(normalizeCampaignItem);
  }
}

export function getCampaignById(campaignId) {
  const campaigns = getCampaigns();
  const found = campaigns.find((c) => c.id === campaignId);
  return found ? found : null;
}

export function getActiveCampaignId() {
  const campaigns = getCampaigns();
  const savedId = localStorage.getItem(ACTIVE_CAMPAIGN_KEY);
  if (savedId && campaigns.some((c) => c.id === savedId)) {
    return savedId;
  }
  const fallbackId = campaigns[0].id;
  localStorage.setItem(ACTIVE_CAMPAIGN_KEY, fallbackId);
  return fallbackId;
}

export function getActiveCampaign() {
  const campaigns = getCampaigns();
  const activeId = getActiveCampaignId();
  const found = campaigns.find((c) => c.id === activeId);
  return found ? found : campaigns[0];
}

export function setActiveCampaign(campaignId) {
  const campaigns = getCampaigns();
  const exists = campaigns.some((c) => c.id === campaignId);
  if (!exists) {
    return null;
  }
  localStorage.setItem(ACTIVE_CAMPAIGN_KEY, campaignId);
  return getActiveCampaign();
}

export function setCampaignStatus(campaignId, nextStatus) {
  const cleanStatus = nextStatus === 'cerrada' ? 'cerrada' : 'activa';
  const campaigns = getCampaigns();
  let updatedItem = null;
  const nextList = campaigns.map((camp) => {
    if (camp.id !== campaignId) {
      return camp;
    }
    updatedItem = normalizeCampaignItem(Object.assign({}, camp, {
      status: cleanStatus,
      closedAt: cleanStatus === 'cerrada' ? Date.now() : 0
    }));
    return updatedItem;
  });
  if (!updatedItem) {
    return null;
  }
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(nextList));
  return updatedItem;
}

export function createCampaign(name, description, cloneTemplatesFromActive, forcedId) {
  const cleanName = name ? String(name).trim() : '';
  if (!cleanName) {
    throw new Error('Ingresa un nombre para la nueva campaña.');
  }
  const campaigns = getCampaigns();
  const now = Date.now();
  const newId = forcedId ? String(forcedId) : 'camp_' + now + '_' + shortRand();
  const newCampaign = normalizeCampaignItem({
    id: newId,
    name: cleanName,
    description: description ? String(description).trim() : '',
    status: 'activa',
    closedAt: 0,
    createdAt: now
  });
  campaigns.push(newCampaign);
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campaigns));

  const currentTemplates = getAllTemplatesRaw();
  const sourceId = getActiveCampaignId();
  const sourceList = cloneTemplatesFromActive
    ? currentTemplates.filter((t) => t.campaignId === sourceId)
    : DEFAULT_TEMPLATES;

  sourceList.forEach((tpl, idx) => {
    currentTemplates.push({
      id: 'tpl_' + now + '_' + idx + '_' + shortRand(),
      campaignId: newId,
      phase: tpl.phase,
      rubro: cloneTemplatesFromActive ? tpl.rubro : '',
      label: tpl.label,
      text: tpl.text
    });
  });

  saveTemplates(currentTemplates);
  localStorage.setItem(ACTIVE_CAMPAIGN_KEY, newId);
  return newCampaign;
}

export function mergeCampaigns(incomingCampaigns, preferredActiveId) {
  const incoming = Array.isArray(incomingCampaigns) ? incomingCampaigns : [];
  if (incoming.length === 0) {
    return { added: 0 };
  }
  const existing = getCampaigns();
  const existingIds = new Set(existing.map((c) => String(c.id)));
  const merged = existing.slice();
  let added = 0;

  incoming.forEach((camp) => {
    if (!(camp && camp.id)) {
      return;
    }
    const id = String(camp.id);
    if (existingIds.has(id)) {
      return;
    }
    existingIds.add(id);
    merged.push(normalizeCampaignItem({
      id: id,
      name: camp.name ? String(camp.name).trim() : 'Campaña importada',
      description: camp.description ? String(camp.description).trim() : '',
      status: camp.status ? camp.status : 'activa',
      closedAt: camp.closedAt,
      createdAt: Number(camp.createdAt) > 0 ? Number(camp.createdAt) : Date.now()
    }));
    added += 1;
  });

  if (added > 0) {
    localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(merged));
  }
  if (preferredActiveId && existing.length === 1 && existing[0].id === DEFAULT_CAMPAIGN_ID) {
    if (merged.some((c) => c.id === preferredActiveId)) {
      localStorage.setItem(ACTIVE_CAMPAIGN_KEY, preferredActiveId);
    }
  }
  return { added: added };
}

export function getAllTemplatesRaw() {
  const raw = localStorage.getItem(TEMPLATES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeTemplateItem);
      }
    } catch (error) {
      return DEFAULT_TEMPLATES.slice();
    }
  }

  const legacyRaw = localStorage.getItem(LEGACY_TEMPLATES_KEY);
  if (legacyRaw) {
    try {
      const legacyParsed = JSON.parse(legacyRaw);
      if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
        const migrated = legacyParsed.map((item, index) => {
          const inferredPhase = index < 3 ? index + 1 : 0;
          return normalizeTemplateItem({
            id: item.id,
            campaignId: DEFAULT_CAMPAIGN_ID,
            phase: item.phase !== undefined ? item.phase : inferredPhase,
            rubro: item.rubro ? item.rubro : '',
            label: item.label,
            text: item.text
          });
        });
        saveTemplates(migrated);
        return migrated;
      }
    } catch (error) {
      saveTemplates(DEFAULT_TEMPLATES);
      return DEFAULT_TEMPLATES.slice();
    }
  }

  saveTemplates(DEFAULT_TEMPLATES);
  return DEFAULT_TEMPLATES.slice();
}

export function getTemplates(campaignIdFilter) {
  const all = getAllTemplatesRaw();
  if (campaignIdFilter === 'all') {
    return all;
  }
  const targetCampaign = campaignIdFilter ? campaignIdFilter : getActiveCampaignId();
  return all.filter((tpl) => tpl.campaignId === targetCampaign);
}

export function saveTemplates(templates) {
  const normalized = Array.isArray(templates) ? templates.map(normalizeTemplateItem) : [];
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(normalized));
}

export function mergeTemplates(incomingTemplates) {
  const incoming = Array.isArray(incomingTemplates) ? incomingTemplates : [];
  if (incoming.length === 0) {
    return { added: 0, updated: 0 };
  }
  const defaultById = new Map(DEFAULT_TEMPLATES.map((t) => [t.id, normalizeTemplateItem(t)]));
  const current = getAllTemplatesRaw();
  const indexById = new Map(current.map((t, idx) => [t.id, idx]));
  const merged = current.slice();
  let added = 0;
  let updated = 0;

  incoming.forEach((raw) => {
    if (!(raw && raw.id)) {
      return;
    }
    const inc = normalizeTemplateItem(raw);
    if (!indexById.has(inc.id)) {
      indexById.set(inc.id, merged.length);
      merged.push(inc);
      added += 1;
      return;
    }
    const idx = indexById.get(inc.id);
    const localTpl = merged[idx];
    const defTpl = defaultById.get(inc.id);
    if (defTpl && templatesEqual(localTpl, defTpl) && !templatesEqual(inc, defTpl)) {
      merged[idx] = inc;
      updated += 1;
    }
  });

  if (added + updated > 0) {
    saveTemplates(merged);
  }
  return { added: added, updated: updated };
}

export function addTemplate(label, text, options) {
  const current = getAllTemplatesRaw();
  const opts = options ? options : {};
  const activeCamp = opts.campaignId ? opts.campaignId : getActiveCampaignId();
  const nextNumber = current.length + 1;
  const cleanLabel = label && label.trim() ? label.trim() : 'Mensaje ' + nextNumber;
  const newItem = normalizeTemplateItem({
    id: 'tpl_' + Date.now() + '_' + shortRand(),
    campaignId: activeCamp,
    phase: opts.phase !== undefined ? opts.phase : 0,
    rubro: opts.rubro ? opts.rubro : '',
    label: cleanLabel,
    text: text.trim()
  });
  current.push(newItem);
  saveTemplates(current);
  return newItem;
}

export function updateTemplate(id, label, text, options) {
  const current = getAllTemplatesRaw();
  const opts = options ? options : {};
  const updated = current.map((item) => {
    if (item.id === id) {
      return normalizeTemplateItem({
        id: item.id,
        campaignId: item.campaignId,
        phase: opts.phase !== undefined ? opts.phase : item.phase,
        rubro: opts.rubro !== undefined ? opts.rubro : item.rubro,
        label: label.trim() ? label.trim() : item.label,
        text: text.trim()
      });
    }
    return item;
  });
  saveTemplates(updated);
}

export function deleteTemplate(id) {
  const current = getAllTemplatesRaw();
  const filtered = current.filter((item) => item.id !== id);
  saveTemplates(filtered);
}

export function renderTemplateText(templateText, lead) {
  const businessName = lead && lead.name ? lead.name.trim() : 'hola';
  const rubroKey = lead && lead.rubro ? lead.rubro : '';
  const rubroLabel = RUBRO_TEXT_MAP[rubroKey] ? RUBRO_TEXT_MAP[rubroKey] : 'negocio';
  return String(templateText)
    .replace(/\{nombre\}/gi, businessName)
    .replace(/\{rubro\}/gi, rubroLabel);
}
