import {
  getInterestTagsCatalog,
  addInterestTagDefinition,
  updateInterestTagDefinition,
  deleteInterestTagDefinition,
  INTEREST_TONES
} from '../services/phase-engine.js';
import {
  renameInterestTagAcrossLeads,
  removeInterestTagAcrossLeads
} from '../services/db-service.js';

function buildToneSelect(selectedTone) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Color de etiqueta');
  const current = selectedTone ? String(selectedTone) : 'hot';
  INTEREST_TONES.forEach((toneItem) => {
    const opt = document.createElement('option');
    opt.value = toneItem.key;
    opt.textContent = toneItem.label;
    if (toneItem.key === current) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  return select;
}

export function syncInterestFilterOptions(selectEl) {
  if (!selectEl) {
    return;
  }
  const previousValue = selectEl.value ? selectEl.value : 'todas';
  const catalog = getInterestTagsCatalog();
  selectEl.innerHTML = '';

  const allOpt = document.createElement('option');
  allOpt.value = 'todas';
  allOpt.textContent = 'Todas las etiquetas de interés';
  selectEl.appendChild(allOpt);

  let stillExists = previousValue === 'todas';
  catalog.forEach((tag) => {
    const opt = document.createElement('option');
    opt.value = tag.id;
    opt.textContent = tag.label;
    if (tag.id === previousValue) {
      stillExists = true;
    }
    selectEl.appendChild(opt);
  });

  selectEl.value = stillExists ? previousValue : 'todas';
}

export function renderInterestTagsEditor(containerEl, onCatalogChanged) {
  if (!containerEl) {
    return;
  }
  const catalog = getInterestTagsCatalog();
  containerEl.innerHTML = '';

  catalog.forEach((tag) => {
    const rowCard = document.createElement('div');
    rowCard.className = 'template-item-card';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = tag.label;

    const toneSelect = buildToneSelect(tag.tone);

    const actions = document.createElement('div');
    actions.className = 'template-item-actions';

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn-primary btn-compact';
    btnSave.textContent = 'Guardar';
    btnSave.addEventListener('click', async () => {
      const nextLabel = nameInput.value.trim() ? nameInput.value.trim() : tag.label;
      updateInterestTagDefinition(tag.id, nextLabel, toneSelect.value);
      await renameInterestTagAcrossLeads(tag.id, nextLabel);
      if (onCatalogChanged) {
        await onCatalogChanged();
      }
      btnSave.textContent = 'Guardado';
      setTimeout(() => {
        btnSave.textContent = 'Guardar';
      }, 1200);
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-danger btn-compact';
    btnDelete.textContent = 'Borrar';
    btnDelete.addEventListener('click', async () => {
      deleteInterestTagDefinition(tag.id);
      await removeInterestTagAcrossLeads(tag.id);
      if (onCatalogChanged) {
        await onCatalogChanged();
      }
      renderInterestTagsEditor(containerEl, onCatalogChanged);
    });

    actions.appendChild(btnSave);
    actions.appendChild(btnDelete);
    rowCard.appendChild(nameInput);
    rowCard.appendChild(toneSelect);
    rowCard.appendChild(actions);
    containerEl.appendChild(rowCard);
  });
}

export async function createNewInterestTag(label, tone, containerEl, onCatalogChanged) {
  addInterestTagDefinition(label, tone);
  if (onCatalogChanged) {
    await onCatalogChanged();
  }
  renderInterestTagsEditor(containerEl, onCatalogChanged);
}
