import { updateLeadRubro, bulkUpdateByIds } from '../services/db-service.js';

export function createSelectionController(elements, state, callbacks) {
  let rubroTargetLead = null;
  let isBulkRubro = false;
  let isBulkStatus = false;

  function syncBar() {
    const count = state.selectedIds.length;
    elements.bulkSelCount.textContent = count === 1 ? '1 seleccionado' : count + ' seleccionados';
    elements.bulkSelectionBar.classList.toggle('hidden', !state.selectionMode);
  }

  async function refreshSelectionVisuals() {
    if (callbacks.onSyncSelectionUi) {
      callbacks.onSyncSelectionUi();
      return;
    }
    if (callbacks.onRender) {
      await callbacks.onRender();
    }
  }

  function exitSelection() {
    state.selectionMode = false;
    state.selectedIds = [];
    isBulkStatus = false;
    syncBar();
  }

  async function enterSelection(lead) {
    state.selectionMode = true;
    state.selectedIds = [lead.id];
    syncBar();
    await refreshSelectionVisuals();
  }

  async function selectAllVisible(visibleIds) {
    const ids = Array.isArray(visibleIds) ? visibleIds.slice() : [];
    if (ids.length === 0) {
      return;
    }
    state.selectionMode = true;
    state.selectedIds = ids;
    syncBar();
    await refreshSelectionVisuals();
  }

  async function toggleSelect(lead) {
    const idx = state.selectedIds.indexOf(lead.id);
    if (idx === -1) {
      state.selectedIds.push(lead.id);
    } else {
      state.selectedIds.splice(idx, 1);
    }
    if (state.selectedIds.length === 0) {
      exitSelection();
    } else {
      syncBar();
    }
    await refreshSelectionVisuals();
  }

  function openSingleRubroPicker(lead) {
    rubroTargetLead = lead;
    isBulkRubro = false;
    elements.rubroPickerTitle.textContent = 'Asignar Rubro';
    elements.rubroPickerSubtitle.textContent = 'Prospecto: ' + lead.name;
    elements.rubroPickerModal.classList.remove('hidden');
  }

  function openBulkRubroPicker() {
    if (state.selectedIds.length === 0) {
      return;
    }
    rubroTargetLead = null;
    isBulkRubro = true;
    elements.rubroPickerTitle.textContent = 'Asignar Rubro en Lote';
    elements.rubroPickerSubtitle.textContent = 'Aplicar a ' + state.selectedIds.length + ' seleccionados';
    elements.rubroPickerModal.classList.remove('hidden');
  }

  function closeRubroPicker() {
    rubroTargetLead = null;
    isBulkRubro = false;
    elements.rubroPickerModal.classList.add('hidden');
  }

  function isBulkStatusActive() {
    return isBulkStatus;
  }

  function clearBulkStatusFlag() {
    isBulkStatus = false;
  }

  async function applyBulkStatus(targetStatus, amountValue) {
    const ids = state.selectedIds.slice();
    isBulkStatus = false;
    if (ids.length === 0) {
      return;
    }
    const parsed = Number(amountValue);
    const cleanAmount = !Number.isNaN(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
    await bulkUpdateByIds(ids, (record, now) => {
      record.status = targetStatus;
      record.saleAmount = targetStatus === 'vendido' ? cleanAmount : 0;
      record.lastContactAt = now;
      return true;
    });
    exitSelection();
    await callbacks.onDataChanged();
  }

  function bind() {
    elements.btnBulkSelCancel.addEventListener('click', async () => {
      exitSelection();
      await refreshSelectionVisuals();
    });

    if (elements.btnBulkSelAll) {
      elements.btnBulkSelAll.addEventListener('click', async () => {
        if (callbacks.getVisibleLeadIds) {
          await selectAllVisible(callbacks.getVisibleLeadIds());
        }
      });
    }

    elements.btnBulkSelTag.addEventListener('click', () => {
      if (state.selectedIds.length > 0 && callbacks.onOpenBulkTagPicker) {
        callbacks.onOpenBulkTagPicker(state.selectedIds.slice());
      }
    });

    elements.btnBulkSelRubro.addEventListener('click', () => {
      openBulkRubroPicker();
    });

    elements.btnBulkSelStatus.addEventListener('click', () => {
      if (state.selectedIds.length === 0) {
        return;
      }
      isBulkStatus = true;
      if (callbacks.onOpenBulkStatusModal) {
        callbacks.onOpenBulkStatusModal(state.selectedIds.length);
      }
    });

    elements.rubroPickerOptions.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-rubro]');
      if (!btn) {
        return;
      }
      const chosenRubro = btn.dataset.rubro;
      const singleTarget = rubroTargetLead;
      const bulkMode = isBulkRubro;
      closeRubroPicker();

      if (singleTarget) {
        await updateLeadRubro(singleTarget.id, chosenRubro);
        await callbacks.onDataChanged();
        return;
      }

      if (bulkMode && state.selectedIds.length > 0) {
        const ids = state.selectedIds.slice();
        await bulkUpdateByIds(ids, (record) => {
          record.rubro = chosenRubro;
          return true;
        });
        exitSelection();
        await callbacks.onDataChanged();
      }
    });

    elements.btnRubroPickerCancel.addEventListener('click', closeRubroPicker);
  }

  return {
    bind,
    enterSelection,
    selectAllVisible,
    toggleSelect,
    exitSelection,
    openSingleRubroPicker,
    isBulkStatusActive,
    clearBulkStatusFlag,
    applyBulkStatus
  };
}
