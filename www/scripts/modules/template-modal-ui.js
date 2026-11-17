import { bulkAssignTagByStatuses, renameTagAcrossLeads } from '../services/db-service.js';
import { RUBRO_CATALOG } from '../services/phase-engine.js';

const PHASE_OPTIONS = [
  { value: 0, label: 'General (Cualquier fase)' },
  { value: 1, label: 'Fase 1 · Primer contacto' },
  { value: 2, label: 'Fase 2 · Seguimiento +3d' },
  { value: 3, label: 'Fase 3 · Cierre ciclo +4d' }
];

function showModalFeedback(el, text) {
  if (!el) {
    return;
  }
  el.textContent = text;
  el.classList.remove('hidden');
}

function buildPhaseSelect(selectedPhase) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Fase de la plantilla');
  const targetVal = Number(selectedPhase);
  PHASE_OPTIONS.forEach((optItem) => {
    const opt = document.createElement('option');
    opt.value = String(optItem.value);
    opt.textContent = optItem.label;
    if (optItem.value === targetVal) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  return select;
}

function buildRubroSelect(selectedRubro) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Rubro de la plantilla');
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'Todos los rubros';
  select.appendChild(allOpt);

  const currentVal = selectedRubro ? String(selectedRubro) : '';
  RUBRO_CATALOG.forEach((rubroItem) => {
    const opt = document.createElement('option');
    opt.value = rubroItem.key;
    opt.textContent = rubroItem.label;
    if (rubroItem.key === currentVal) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  return select;
}

export async function syncCampaignFilterOptions(selectEl) {
  if (!selectEl) {
    return;
  }
  const tplModule = await import('../services/template-service.js');
  const previousValue = selectEl.value ? selectEl.value : 'todas';
  const templates = tplModule.getTemplates();
  selectEl.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = 'todas';
  allOption.textContent = 'Todas las plantillas';
  selectEl.appendChild(allOption);

  let stillExists = previousValue === 'todas';
  templates.forEach((tpl) => {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = tpl.label;
    if (tpl.id === previousValue) {
      stillExists = true;
    }
    selectEl.appendChild(opt);
  });

  selectEl.value = stillExists ? previousValue : 'todas';
}

export async function renderTemplatesEditor(containerEl, callbacks) {
  const tplModule = await import('../services/template-service.js');
  const hooks = callbacks ? callbacks : {};
  containerEl.innerHTML = '';

  tplModule.getTemplates().forEach((tpl) => {
    const itemBox = document.createElement('div');
    itemBox.className = 'template-item-card';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = tpl.label;

    const metaRow = document.createElement('div');
    metaRow.className = 'template-meta-selects';
    const phaseSelect = buildPhaseSelect(tpl.phase);
    const rubroSelect = buildRubroSelect(tpl.rubro);
    metaRow.appendChild(phaseSelect);
    metaRow.appendChild(rubroSelect);

    const textArea = document.createElement('textarea');
    textArea.rows = 3;
    textArea.value = tpl.text;

    const rowActions = document.createElement('div');
    rowActions.className = 'template-item-actions';

    const btnBulk = document.createElement('button');
    btnBulk.type = 'button';
    btnBulk.className = 'btn-secondary btn-compact';
    btnBulk.textContent = 'Asignar a grupo';
    btnBulk.addEventListener('click', () => {
      if (hooks.onOpenBulkTag) {
        hooks.onOpenBulkTag({
          id: tpl.id,
          label: labelInput.value.trim() ? labelInput.value.trim() : tpl.label
        });
      }
    });

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn-primary btn-compact';
    btnSave.textContent = 'Guardar';
    btnSave.addEventListener('click', async () => {
      const nextLabel = labelInput.value.trim() ? labelInput.value.trim() : tpl.label;
      tplModule.updateTemplate(tpl.id, nextLabel, textArea.value, {
        phase: Number(phaseSelect.value),
        rubro: rubroSelect.value
      });
      await renameTagAcrossLeads(tpl.id, nextLabel);
      if (hooks.onTemplatesChanged) {
        await hooks.onTemplatesChanged();
      }
      btnSave.textContent = 'Guardado';
      setTimeout(() => {
        btnSave.textContent = 'Guardar';
      }, 1200);
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-danger btn-compact';
    btnRemove.textContent = 'Borrar';
    btnRemove.addEventListener('click', async () => {
      tplModule.deleteTemplate(tpl.id);
      if (hooks.onTemplatesChanged) {
        await hooks.onTemplatesChanged();
      }
      await renderTemplatesEditor(containerEl, hooks);
    });

    rowActions.appendChild(btnBulk);
    rowActions.appendChild(btnSave);
    rowActions.appendChild(btnRemove);
    itemBox.appendChild(labelInput);
    itemBox.appendChild(metaRow);
    itemBox.appendChild(textArea);
    itemBox.appendChild(rowActions);
    containerEl.appendChild(itemBox);
  });
}

export async function createNewTemplate(label, text, options, containerEl, callbacks) {
  const tplModule = await import('../services/template-service.js');
  tplModule.addTemplate(label, text, options);
  if (callbacks && callbacks.onTemplatesChanged) {
    await callbacks.onTemplatesChanged();
  }
  await renderTemplatesEditor(containerEl, callbacks);
}

export async function renderManualTagOptions(lead, listEl, onPickTag) {
  const tplModule = await import('../services/template-service.js');
  const templates = tplModule.getTemplates();
  const existingTags = Array.isArray(lead.sentTags) ? lead.sentTags : [];
  listEl.innerHTML = '';

  templates.forEach((tpl) => {
    const alreadyAssigned = existingTags.some((tag) => tag.id === tpl.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = alreadyAssigned ? 'btn-secondary' : 'btn-primary';
    btn.disabled = alreadyAssigned;
    btn.textContent = alreadyAssigned ? tpl.label + ' (Ya asignada)' : tpl.label;
    btn.addEventListener('click', () => {
      onPickTag(lead, tpl);
    });
    listEl.appendChild(btn);
  });
}

export async function applyBulkTagSelection(tpl, checksEl, feedbackEl, sentAt, onComplete) {
  if (!tpl) {
    return;
  }
  const checkedInputs = checksEl.querySelectorAll('input[type="checkbox"]:checked');
  const statuses = [];
  checkedInputs.forEach((input) => {
    statuses.push(input.value);
  });

  if (statuses.length === 0) {
    showModalFeedback(feedbackEl, 'Selecciona al menos una etapa del embudo.');
    return;
  }

  const updatedCount = await bulkAssignTagByStatuses(statuses, {
    id: tpl.id,
    label: tpl.label,
    sentAt: sentAt
  });
  await onComplete();
  showModalFeedback(
    feedbackEl,
    'Etiqueta "' + tpl.label + '" aplicada a ' + updatedCount + ' prospectos.'
  );
}
