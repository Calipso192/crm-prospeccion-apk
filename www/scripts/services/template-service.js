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
    createdAt: 1700000000000
  }
];

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_1',
    campaignId: DEFAULT_CAMPAIGN_ID,
    phase: 1,
    rubro: '',
    label: 'Fase 1 · Primer contacto',
    text: 'Hola {nombre}, un gusto saludarte. Te escribo para presentarte una propuesta que puede ayudarte a fidelizar más clientes en tu negocio.'
  },
  {
    id: 'tpl_2',
    campaignId: DEFAULT_CAMPAIGN_ID,
    phase: 2,
    rubro: '',
    label: 'Fase 2 · Seguimiento 3 días',
    text: 'Hola {nombre}, retomando mi mensaje anterior, ¿pudiste revisar la propuesta? Te puedo mostrar cómo funciona en menos de 2 minutos.'
  },
  {
    id: 'tpl_3',
    campaignId: DEFAULT_CAMPAIGN_ID,
    phase: 3,
    rubro: '',
    label: 'Fase 3 · Cierre de ciclo',
    text: 'Hola {nombre}, te dejo por aquí el enlace con la demostración rápida por si más adelante deseas implementarlo en tu local. ¡Éxitos!'
  }
];

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

export function getCampaigns() {
  try {
    const raw = localStorage.getItem(CAMPAIGNS_KEY);
    if (!raw) {
      localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(DEFAULT_CAMPAIGNS));
      return DEFAULT_CAMPAIGNS.slice();
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_CAMPAIGNS.slice();
  } catch (error) {
    return DEFAULT_CAMPAIGNS.slice();
  }
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

export function createCampaign(name, description, cloneTemplatesFromActive) {
  const cleanName = name ? String(name).trim() : '';
  if (!cleanName) {
    throw new Error('Ingresa un nombre para la nueva campaña.');
  }
  const campaigns = getCampaigns();
  const newId = 'camp_' + Date.now();
  const newCampaign = {
    id: newId,
    name: cleanName,
    description: description ? String(description).trim() : '',
    createdAt: Date.now()
  };
  campaigns.push(newCampaign);
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campaigns));

  const currentTemplates = getAllTemplatesRaw();
  if (cloneTemplatesFromActive) {
    const sourceId = getActiveCampaignId();
    const sourceTemplates = currentTemplates.filter((t) => t.campaignId === sourceId);
    sourceTemplates.forEach((tpl, idx) => {
      currentTemplates.push({
        id: 'tpl_' + Date.now() + '_' + idx,
        campaignId: newId,
        phase: tpl.phase,
        rubro: tpl.rubro,
        label: tpl.label,
        text: tpl.text
      });
    });
  } else {
    DEFAULT_TEMPLATES.forEach((tpl, idx) => {
      currentTemplates.push({
        id: 'tpl_' + Date.now() + '_' + idx,
        campaignId: newId,
        phase: tpl.phase,
        rubro: '',
        label: tpl.label,
        text: tpl.text
      });
    });
  }
  saveTemplates(currentTemplates);
  localStorage.setItem(ACTIVE_CAMPAIGN_KEY, newId);
  return newCampaign;
}

export function getAllTemplatesRaw() {
  const raw = localStorage.getItem(TEMPLATES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
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
  const filtered = all.filter((tpl) => tpl.campaignId === targetCampaign);
  return filtered.length > 0 ? filtered : all;
}

export function saveTemplates(templates) {
  const normalized = Array.isArray(templates) ? templates.map(normalizeTemplateItem) : [];
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(normalized));
}

export function addTemplate(label, text, options) {
  const current = getAllTemplatesRaw();
  const opts = options ? options : {};
  const activeCamp = opts.campaignId ? opts.campaignId : getActiveCampaignId();
  const nextNumber = current.length + 1;
  const cleanLabel = label && label.trim() ? label.trim() : 'Mensaje ' + nextNumber;
  const newItem = normalizeTemplateItem({
    id: 'tpl_' + Date.now(),
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
