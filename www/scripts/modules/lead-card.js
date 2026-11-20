import { formatReminderLabel, formatRelativeTimeAgo } from '../services/reminder-service.js';
import {
  evaluateLeadPhase,
  evaluateReminderUrgency,
  getInterestTagsCatalog,
  RUBRO_CATALOG
} from '../services/phase-engine.js';

const STATUS_LABELS = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  seguimiento: 'Seguimiento',
  vendido: 'Vendido',
  descartado: 'Descartado',
  sin_whatsapp: 'Sin WhatsApp'
};

const RUBRO_LABELS = {};
RUBRO_CATALOG.forEach((item) => {
  RUBRO_LABELS[item.key] = item.label;
});

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) {
    node.className = cls;
  }
  if (text !== undefined && text !== null) {
    node.textContent = String(text);
  }
  return node;
}

function inSelection(handlers) {
  if (handlers && typeof handlers.isSelectionActive === 'function') {
    return Boolean(handlers.isSelectionActive());
  }
  return Boolean(handlers && handlers.isSelectionMode);
}

function isFinalStatus(statusKey) {
  return statusKey === 'vendido' ? true : statusKey === 'descartado';
}

function formatShortDate(timestamp) {
  const dateObj = new Date(Number(timestamp));
  if (Number.isNaN(dateObj.getTime())) {
    return '';
  }
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  return day + '/' + month;
}

function formatNoteTimestamp(timestamp) {
  const dateObj = new Date(Number(timestamp));
  if (Number.isNaN(dateObj.getTime())) {
    return '';
  }
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const hrs = String(dateObj.getHours()).padStart(2, '0');
  const mins = String(dateObj.getMinutes()).padStart(2, '0');
  return day + '/' + month + ' ' + hrs + ':' + mins;
}

function getTagColorClass(tagId) {
  const str = String(tagId);
  let sum = 0;
  for (let i = 0; i < str.length; i += 1) {
    sum += str.charCodeAt(i);
  }
  return 'tag-tone-' + (sum % 5);
}

function resolveTagDisplayLabel(tag, handlers) {
  if (handlers && handlers.tagLabelsMap && handlers.tagLabelsMap[tag.id]) {
    return handlers.tagLabelsMap[tag.id];
  }
  return tag.label;
}

function buildMetaRow(lead, statusKey, phaseInfo, handlers) {
  const metaRow = el('div', 'lead-meta-row');

  if (phaseInfo.badgeText) {
    const phaseCls = phaseInfo.isActionDue ? 'phase-pill phase-due' : 'phase-pill';
    const text = phaseInfo.detailText ? phaseInfo.badgeText + ' · ' + phaseInfo.detailText : phaseInfo.badgeText;
    metaRow.appendChild(el('span', phaseCls, text));
  }

  if (statusKey === 'seguimiento') {
    metaRow.appendChild(el('span', 'last-contact-tag', 'Último: ' + formatRelativeTimeAgo(lead.lastContactAt)));
  }

  if (statusKey === 'vendido' && Number(lead.saleAmount) > 0) {
    metaRow.appendChild(el('span', 'lead-amount-tag', 'Facturado: S/ ' + Number(lead.saleAmount).toFixed(2)));
  }

  if (!isFinalStatus(statusKey)) {
    const reminderLabel = formatReminderLabel(lead.reminderAt, lead.reminderReason);
    if (reminderLabel) {
      const urg = evaluateReminderUrgency(lead);
      const remBtn = el('button', 'lead-reminder-tag urgency-' + urg.level, 'Agenda: ' + reminderLabel);
      remBtn.type = 'button';
      remBtn.addEventListener('click', (ev) => {
        if (inSelection(handlers)) { return; }
        ev.stopPropagation();
        if (handlers.onOpenReminderModal) {
          handlers.onOpenReminderModal(lead);
        }
      });
      metaRow.appendChild(remBtn);
    }
  }

  return metaRow.childNodes.length > 0 ? metaRow : null;
}

function buildSentTagsRow(lead, handlers) {
  const tagsRow = el('div', 'lead-tags-row');
  const tags = Array.isArray(lead.sentTags) ? lead.sentTags : [];

  tags.forEach((tag) => {
    const displayLabel = resolveTagDisplayLabel(tag, handlers);
    const chip = el('span', 'sent-tag-chip ' + getTagColorClass(tag.id));
    const dateStr = formatShortDate(tag.sentAt);
    chip.appendChild(el('span', '', dateStr ? displayLabel + ' · ' + dateStr : displayLabel));

    const removeBtn = el('button', 'tag-remove-btn', '×');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', 'Quitar etiqueta ' + displayLabel);
    removeBtn.addEventListener('click', (ev) => {
      if (inSelection(handlers)) { return; }
      ev.stopPropagation();
      if (handlers.onRemoveTag) {
        handlers.onRemoveTag(lead, Object.assign({}, tag, { label: displayLabel }));
      }
    });

    chip.appendChild(removeBtn);
    tagsRow.appendChild(chip);
  });

  const addBtn = el('button', 'btn-add-tag', '+ Fase');
  addBtn.type = 'button';
  addBtn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onOpenAddTag) {
      handlers.onOpenAddTag(lead);
    }
  });
  tagsRow.appendChild(addBtn);
  return tagsRow;
}

function buildInterestRow(lead, statusKey, handlers) {
  const activeTags = Array.isArray(lead.interestTags) ? lead.interestTags : [];
  if (statusKey !== 'seguimiento' && activeTags.length === 0) {
    return null;
  }
  const activeIds = activeTags.map((t) => t.id);
  const catalog = Array.isArray(handlers.interestCatalog) ? handlers.interestCatalog : getInterestTagsCatalog();
  const row = el('div', 'interest-tags-row');

  catalog.forEach((tagObj) => {
    const isActive = activeIds.indexOf(tagObj.id) !== -1;
    if (statusKey !== 'seguimiento' && !isActive) {
      return;
    }
    const cls = isActive ? 'interest-chip active heat-' + tagObj.tone : 'interest-chip heat-' + tagObj.tone;
    const btn = el('button', cls, tagObj.label);
    btn.type = 'button';
    btn.addEventListener('click', (ev) => {
      if (inSelection(handlers)) { return; }
      ev.stopPropagation();
      if (handlers.onToggleInterestTag) {
        handlers.onToggleInterestTag(lead, tagObj);
      }
    });
    row.appendChild(btn);
  });

  return row.childNodes.length > 0 ? row : null;
}

function createQuickNoteItem(lead, item, handlers) {
  const noteRow = el('div', 'quick-note-item');
  const stamp = formatNoteTimestamp(item.createdAt);
  const lineText = stamp ? '[' + stamp + '] ' + item.text : item.text;
  noteRow.appendChild(el('span', 'quick-note-text', lineText));

  const delBtn = el('button', 'quick-note-remove-btn', '×');
  delBtn.type = 'button';
  delBtn.setAttribute('aria-label', 'Borrar nota rápida');
  delBtn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onRemoveQuickNote) {
      handlers.onRemoveQuickNote(lead, item.id);
    }
  });
  noteRow.appendChild(delBtn);
  return noteRow;
}

function buildNotesSection(lead, statusKey, handlers) {
  const wrap = el('div', 'lead-notes-wrap');
  if (lead.notes) {
    wrap.appendChild(el('p', 'lead-notes', lead.notes));
  }

  const qNotes = Array.isArray(lead.quickNotes) ? lead.quickNotes : [];
  if (qNotes.length > 0) {
    const list = el('div', 'quick-notes-list');
    qNotes.slice(0, 4).forEach((item) => list.appendChild(createQuickNoteItem(lead, item, handlers)));
    wrap.appendChild(list);

    if (qNotes.length > 4) {
      const extraCount = qNotes.length - 4;
      const extraList = el('div', 'quick-notes-list hidden');
      qNotes.slice(4).forEach((item) => extraList.appendChild(createQuickNoteItem(lead, item, handlers)));
      wrap.appendChild(extraList);

      const btnMore = el('button', 'btn-notes-more', 'Ver ' + extraCount + ' notas más');
      btnMore.type = 'button';
      btnMore.addEventListener('click', (ev) => {
        if (inSelection(handlers)) { return; }
        ev.stopPropagation();
        const isHidden = extraList.classList.toggle('hidden');
        btnMore.textContent = isHidden ? 'Ver ' + extraCount + ' notas más' : 'Ocultar notas anteriores';
      });
      wrap.appendChild(btnMore);
    }
  }

  if (statusKey === 'seguimiento') {
    const bar = el('div', 'quick-note-bar');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Nota rápida con fecha...';
    input.addEventListener('click', (ev) => {
      if (inSelection(handlers)) {
        input.blur();
        return;
      }
      ev.stopPropagation();
    });
    const saveBtn = el('button', 'btn-primary btn-compact', '+ Nota');
    saveBtn.type = 'button';
    const submitNote = () => {
      const val = input.value.trim();
      if (val && !inSelection(handlers) && handlers.onAddQuickNote) {
        input.value = '';
        handlers.onAddQuickNote(lead, val);
      }
    };
    saveBtn.addEventListener('click', (ev) => {
      if (inSelection(handlers)) { return; }
      ev.stopPropagation();
      submitNote();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submitNote();
      }
    });
    bar.appendChild(input);
    bar.appendChild(saveBtn);
    wrap.appendChild(bar);
  }

  return wrap.childNodes.length > 0 ? wrap : null;
}

function attachCardGestures(card, lead, handlers) {
  let pressTimer = null;
  let startX = 0;
  let startY = 0;
  let longPressTriggered = false;

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    card.classList.remove('lead-card-pressing');
  };

  card.addEventListener('pointerdown', (ev) => {
    if (inSelection(handlers)) { return; }
    if (ev.button && ev.button !== 0) { return; }
    if (ev.target.closest('button') || ev.target.closest('input')) { return; }
    startX = ev.clientX;
    startY = ev.clientY;
    longPressTriggered = false;
    card.classList.add('lead-card-pressing');
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressTriggered = true;
      card.classList.remove('lead-card-pressing');
      if (handlers.onEnterSelection) {
        handlers.onEnterSelection(lead);
      }
    }, 450);
  });

  card.addEventListener('pointermove', (ev) => {
    if (!pressTimer) { return; }
    if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) {
      cancelPress();
    }
  });

  card.addEventListener('pointerup', cancelPress);
  card.addEventListener('pointercancel', cancelPress);
  card.addEventListener('contextmenu', (ev) => {
    if (pressTimer || longPressTriggered) {
      ev.preventDefault();
      longPressTriggered = false;
    }
  });

  card.addEventListener('click', (ev) => {
    if (inSelection(handlers)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (handlers.onToggleSelect) {
        handlers.onToggleSelect(lead);
      }
    }
  });
}

function buildHeader(lead, statusKey, handlers) {
  const header = el('div', 'lead-header');
  const leftWrap = el('div', 'lead-header-left');

  const isSelMode = Boolean(handlers.isSelectionMode);
  const checkCls = !isSelMode
    ? 'select-check hidden'
    : (handlers.isSelected ? 'select-check checked' : 'select-check');
  const checkBox = el('span', checkCls, isSelMode && handlers.isSelected ? '✓' : '');
  leftWrap.appendChild(checkBox);

  const infoBox = el('div');
  infoBox.appendChild(el('h3', 'lead-title', lead.name));

  const subRow = el('div', 'lead-sub-row');
  subRow.appendChild(el('span', 'lead-phone', '+' + lead.phone));

  const hasRubro = Boolean(lead.rubro && RUBRO_LABELS[lead.rubro]);
  const rubroBtn = el('button', hasRubro ? 'rubro-btn rubro-' + lead.rubro : 'rubro-btn rubro-empty', hasRubro ? RUBRO_LABELS[lead.rubro] : '+ Rubro');
  rubroBtn.type = 'button';
  rubroBtn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onPickRubro) {
      handlers.onPickRubro(lead);
    }
  });
  subRow.appendChild(rubroBtn);

  infoBox.appendChild(subRow);
  leftWrap.appendChild(infoBox);

  const pillBtn = el('button', 'status-pill status-' + statusKey, STATUS_LABELS[statusKey] ? STATUS_LABELS[statusKey] : statusKey);
  pillBtn.type = 'button';
  pillBtn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    if (handlers.onQuickStatus) {
      handlers.onQuickStatus(lead);
    }
  });

  header.appendChild(leftWrap);
  header.appendChild(pillBtn);
  return header;
}

function createCardActionBtn(cls, label, handlers, callback) {
  const btn = el('button', cls, label);
  btn.type = 'button';
  btn.addEventListener('click', (ev) => {
    if (inSelection(handlers)) { return; }
    ev.stopPropagation();
    callback();
  });
  return btn;
}

export function createLeadCard(lead, handlers) {
  const selectedClass = handlers.isSelectionMode && handlers.isSelected ? ' lead-card-selected' : '';
  const card = el('article', 'lead-card' + selectedClass);
  card.dataset.id = lead.id;
  attachCardGestures(card, lead, handlers);

  const statusKey = lead.status ? lead.status : 'nuevo';
  const phaseInfo = evaluateLeadPhase(lead);

  card.appendChild(buildHeader(lead, statusKey, handlers));

  const metaRow = buildMetaRow(lead, statusKey, phaseInfo, handlers);
  if (metaRow) { card.appendChild(metaRow); }

  const interestRow = buildInterestRow(lead, statusKey, handlers);
  if (interestRow) { card.appendChild(interestRow); }

  card.appendChild(buildSentTagsRow(lead, handlers));

  const notesBlock = buildNotesSection(lead, statusKey, handlers);
  if (notesBlock) { card.appendChild(notesBlock); }

  const actions = el('div', 'lead-actions');
  if (statusKey === 'sin_whatsapp') {
    actions.appendChild(createCardActionBtn('btn-warning', 'Llamar', handlers, () => handlers.onCall(lead)));
    actions.appendChild(createCardActionBtn('btn-secondary', 'Buscar', handlers, () => handlers.onSearch(lead)));
  } else {
    actions.appendChild(createCardActionBtn('btn-whatsapp', 'WhatsApp', handlers, () => handlers.onWhatsApp(lead)));
  }

  if (!isFinalStatus(statusKey) && handlers.onOpenReminderModal) {
    actions.appendChild(createCardActionBtn('btn-calendar', 'Agendar', handlers, () => handlers.onOpenReminderModal(lead)));
  }

  if (phaseInfo.phaseCode === 'listo_descartar' && handlers.onQuickDiscard) {
    actions.appendChild(createCardActionBtn('btn-secondary', 'Descartar', handlers, () => handlers.onQuickDiscard(lead)));
  }

  actions.appendChild(createCardActionBtn('btn-secondary', 'Editar', handlers, () => handlers.onEdit(lead)));
  actions.appendChild(createCardActionBtn('btn-danger', 'Borrar', handlers, () => handlers.onDelete(lead)));
  card.appendChild(actions);

  return card;
}
