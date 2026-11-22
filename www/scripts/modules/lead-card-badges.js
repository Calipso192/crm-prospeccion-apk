import { RUBRO_CATALOG } from '../services/phase-engine.js';

const METHOD_LABELS = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  llamada: 'Llamada'
};

const RUBRO_LABELS = {};
RUBRO_CATALOG.forEach((item) => {
  RUBRO_LABELS[item.key] = item.label;
});

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) { node.className = cls; }
  if (text !== undefined && text !== null) { node.textContent = String(text); }
  return node;
}

function inSelection(handlers) {
  if (handlers && typeof handlers.isSelectionActive === 'function') {
    return Boolean(handlers.isSelectionActive());
  }
  return Boolean(handlers && handlers.isSelectionMode);
}

export function getScoreToneClass(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return 'score-empty';
  }
  const val = Number(score);
  if (val >= 8) { return 'score-high'; }
  if (val >= 5) { return 'score-mid'; }
  return 'score-low';
}

export function buildScoreBadge(lead, handlers) {
  const hasScore = lead.score !== null && lead.score !== undefined && !Number.isNaN(Number(lead.score));
  const label = hasScore ? Number(lead.score).toFixed(1).replace(/\.0$/, '') + '/10' : '+ Score';
  const btn = el('button', 'score-badge ' + getScoreToneClass(lead.score), hasScore ? 'IA ' + label : label);
  btn.type = 'button';
  btn.title = 'Editar Score IA';
  btn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onPickScore) {
      handlers.onPickScore(lead);
    }
  });
  return btn;
}

export function buildContactMethodBadge(lead, handlers) {
  const method = lead.contactMethod ? String(lead.contactMethod) : '';
  const hasMethod = Boolean(method && METHOD_LABELS[method]);
  const cls = hasMethod ? 'contact-method-badge method-' + method : 'contact-method-badge method-empty';
  const text = hasMethod ? METHOD_LABELS[method] : '+ Canal';
  const btn = el('button', cls, text);
  btn.type = 'button';
  btn.title = 'Cambiar método de contacto recomendado';
  btn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onCycleContactMethod) {
      handlers.onCycleContactMethod(lead);
    }
  });
  return btn;
}

export function buildRubroBadge(lead, handlers) {
  const hasRubro = Boolean(lead.rubro && RUBRO_LABELS[lead.rubro]);
  const cls = hasRubro ? 'rubro-btn rubro-' + lead.rubro : 'rubro-btn rubro-empty';
  const text = hasRubro ? RUBRO_LABELS[lead.rubro] : '+ Rubro';
  const btn = el('button', cls, text);
  btn.type = 'button';
  btn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onPickRubro) {
      handlers.onPickRubro(lead);
    }
  });
  return btn;
}

export function buildInstagramBadge(lead, handlers) {
  if (!lead.instagram) {
    return null;
  }
  const btn = el('button', 'lead-ig-badge clickable', '@' + lead.instagram);
  btn.type = 'button';
  btn.title = 'Abrir Instagram';
  btn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onInstagram) {
      handlers.onInstagram(lead);
    }
  });
  return btn;
}
