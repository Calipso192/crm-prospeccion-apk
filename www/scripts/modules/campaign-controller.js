import {
  addTagToLead,
  removeTagFromLead,
  bulkUpdateByIds,
  archiveAndStartNewCampaign
} from '../services/db-service.js';
import {
  RETROACTIVE_DAYS,
  computeRetroactiveTimestamp
} from '../services/phase-engine.js';
import {
  createCampaign,
  getActiveCampaign,
  setActiveCampaign
} from '../services/template-service.js';
import {
  syncCampaignFilterOptions,
  renderManualTagOptions,
  applyBulkTagSelection
} from './template-modal-ui.js';
import { syncInterestFilterOptions } from './interest-manager-ui.js';

export function matchesRubroAndCampaign(lead, filterState) {
  if (filterState.rubro !== 'todos') {
    const leadRubro = lead.rubro ? lead.rubro : '';
    if (leadRubro !== filterState.rubro) {
      return false;
    }
  }

  if (filterState.interestFilter && filterState.interestFilter !== 'todas') {
    const interestList = Array.isArray(lead.interestTags) ? lead.interestTags : [];
    const hasInterest = interestList.some((item) => item.id === filterState.interestFilter);
    if (!hasInterest) {
      return false;
    }
  }

  if (filterState.campaignTplId === 'todas') {
    return true;
  }

  const tags = Array.isArray(lead.sentTags) ? lead.sentTags : [];
  const hasTag = tags.some((tag) => tag.id === filterState.campaignTplId);

  if (filterState.campaignState === 'enviado') {
    return hasTag;
  }
  return !hasTag;
}

export function createCampaignController(elements, filterState, callbacks) {
  let bulkTargetTpl = null;
  let selectedRetroDays = 0;
  let campaignConfirmPending = false;

  function resetCampaignConfirm() {
    campaignConfirmPending = false;
    if (elements.btnSubmitNewCampaign) {
      elements.btnSubmitNewCampaign.textContent = 'Iniciar Campaña';
    }
    if (elements.newCampaignFeedback) {
      elements.newCampaignFeedback.classList.add('hidden');
    }
  }

  function renderRetroChips() {
    if (!elements.tagRetroactiveRow) {
      return;
    }
    elements.tagRetroactiveRow.innerHTML = '';
    RETROACTIVE_DAYS.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = item.daysAgo === selectedRetroDays ? 'chip-action active' : 'chip-action';
      btn.dataset.retroDays = String(item.daysAgo);
      btn.textContent = item.label;
      elements.tagRetroactiveRow.appendChild(btn);
    });
  }

  async function refreshFilterDropdown() {
    await syncCampaignFilterOptions(elements.campaignTplFilter);
    const currentVal = elements.campaignTplFilter.value;
    filterState.campaignTplId = currentVal ? currentVal : 'todas';
    const isAll = filterState.campaignTplId === 'todas';
    elements.campaignStatusRow.classList.toggle('hidden', isAll);

    if (elements.interestFilter) {
      syncInterestFilterOptions(elements.interestFilter);
      const currentInt = elements.interestFilter.value;
      filterState.interestFilter = currentInt ? currentInt : 'todas';
    }
  }

  async function openManualTagModal(lead) {
    selectedRetroDays = 0;
    renderRetroChips();
    if (elements.tagPickerTitle) {
      elements.tagPickerTitle.textContent = 'Asignar etiqueta de fase';
    }
    elements.tagPickerLeadName.textContent = 'Prospecto: ' + lead.name;
    await renderManualTagOptions(lead, elements.tagPickerList, async (targetLead, tpl) => {
      elements.tagPickerModal.classList.add('hidden');
      const sentAt = computeRetroactiveTimestamp(selectedRetroDays);
      await addTagToLead(targetLead.id, {
        id: tpl.id,
        label: tpl.label,
        phase: Number(tpl.phase) || 0,
        sentAt: sentAt
      });
      await callbacks.onDataChanged();
    });
    elements.tagPickerModal.classList.remove('hidden');
  }

  async function openBulkSelectedTagModal(selectedIds, onSelectionDone) {
    const ids = Array.isArray(selectedIds) ? selectedIds.slice() : [];
    if (ids.length === 0) {
      return;
    }
    selectedRetroDays = 0;
    renderRetroChips();
    if (elements.tagPickerTitle) {
      elements.tagPickerTitle.textContent = 'Etiquetar seleccionados';
    }
    const labelCount = ids.length === 1 ? '1 prospecto seleccionado' : ids.length + ' prospectos seleccionados';
    elements.tagPickerLeadName.textContent = labelCount;

    const dummyLead = { name: labelCount, sentTags: [] };
    await renderManualTagOptions(dummyLead, elements.tagPickerList, async (ignoredLead, tpl) => {
      elements.tagPickerModal.classList.add('hidden');
      const sentAt = computeRetroactiveTimestamp(selectedRetroDays);
      await bulkUpdateByIds(ids, (record, now) => {
        const exists = record.sentTags.some((t) => t.id === tpl.id);
        if (exists) {
          return false;
        }
        const hadPrior = record.sentTags.length > 0 || record.quickNotes.length > 0 || record.interestTags.length > 0;
        const entry = {
          id: String(tpl.id),
          label: tpl.label ? String(tpl.label).trim() : String(tpl.id),
          sentAt: sentAt
        };
        if (tpl.phase !== undefined && tpl.phase !== null) {
          const cleanPhase = Number(tpl.phase);
          entry.phase = (cleanPhase === 1 || cleanPhase === 2 || cleanPhase === 3) ? cleanPhase : 0;
        }
        record.sentTags.push(entry);
        record.lastContactAt = hadPrior ? Math.max(Number(record.lastContactAt) || 0, sentAt) : sentAt;
        record.updatedAt = now;
        return true;
      });
      if (onSelectionDone) {
        onSelectionDone();
      }
      await callbacks.onDataChanged();
    });
    elements.tagPickerModal.classList.remove('hidden');
  }

  function openBulkTagModal(tpl) {
    bulkTargetTpl = tpl;
    elements.bulkTagTplName.textContent = 'Plantilla: ' + tpl.label;
    elements.bulkTagFeedback.classList.add('hidden');
    if (elements.bulkTagRetroSelect) {
      elements.bulkTagRetroSelect.value = '0';
    }
    elements.bulkTagModal.classList.remove('hidden');
  }

  async function removeTag(lead, tag) {
    await removeTagFromLead(lead.id, tag.id);
    await callbacks.onDataChanged();
  }

  function openNewCampaignModal() {
    if (!elements.newCampaignModal) {
      return;
    }
    if (elements.newCampaignForm) {
      elements.newCampaignForm.reset();
    }
    resetCampaignConfirm();
    elements.newCampaignModal.classList.remove('hidden');
  }

  async function switchCampaign(campaignId) {
    const updated = setActiveCampaign(campaignId);
    if (!updated) {
      return;
    }
    await refreshFilterDropdown();
    await callbacks.onDataChanged();
  }

  function bind() {
    if (elements.tagRetroactiveRow) {
      elements.tagRetroactiveRow.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-retro-days]');
        if (!btn) {
          return;
        }
        selectedRetroDays = Number(btn.dataset.retroDays);
        renderRetroChips();
      });
    }

    elements.rubroFilter.addEventListener('change', async () => {
      filterState.rubro = elements.rubroFilter.value;
      await callbacks.onFilterChange();
    });

    if (elements.interestFilter) {
      elements.interestFilter.addEventListener('change', async () => {
        filterState.interestFilter = elements.interestFilter.value;
        await callbacks.onFilterChange();
      });
    }

    elements.campaignTplFilter.addEventListener('change', async () => {
      filterState.campaignTplId = elements.campaignTplFilter.value;
      const isAll = filterState.campaignTplId === 'todas';
      elements.campaignStatusRow.classList.toggle('hidden', isAll);
      await callbacks.onFilterChange();
    });

    elements.campaignStatusRow.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-camp-state]');
      if (!btn) {
        return;
      }
      elements.campaignStatusRow.querySelectorAll('.camp-chip').forEach((chip) => {
        chip.classList.remove('active');
      });
      btn.classList.add('active');
      filterState.campaignState = btn.dataset.campState;
      await callbacks.onFilterChange();
    });

    elements.btnTagPickerCancel.addEventListener('click', () => {
      elements.tagPickerModal.classList.add('hidden');
    });

    elements.btnCancelBulkTag.addEventListener('click', () => {
      bulkTargetTpl = null;
      elements.bulkTagModal.classList.add('hidden');
    });

    elements.btnConfirmBulkTag.addEventListener('click', async () => {
      const retroDays = elements.bulkTagRetroSelect ? Number(elements.bulkTagRetroSelect.value) : 0;
      const sentAt = computeRetroactiveTimestamp(retroDays);
      await applyBulkTagSelection(
        bulkTargetTpl,
        elements.bulkStatusChecks,
        elements.bulkTagFeedback,
        sentAt,
        callbacks.onDataChanged
      );
    });

    if (elements.btnCancelNewCampaign) {
      elements.btnCancelNewCampaign.addEventListener('click', () => {
        resetCampaignConfirm();
        elements.newCampaignModal.classList.add('hidden');
      });
    }

    if (elements.newCampaignName) {
      elements.newCampaignName.addEventListener('input', () => {
        if (campaignConfirmPending) {
          resetCampaignConfirm();
        }
      });
    }

    if (elements.newCampaignForm) {
      elements.newCampaignForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          const nameVal = elements.newCampaignName.value ? elements.newCampaignName.value.trim() : '';
          if (!nameVal) {
            throw new Error('Ingresa un nombre para la nueva campaña.');
          }
          if (!campaignConfirmPending) {
            campaignConfirmPending = true;
            const totalLeads = callbacks.getLeadCount ? callbacks.getLeadCount() : 0;
            if (elements.newCampaignFeedback) {
              elements.newCampaignFeedback.textContent = 'Se archivarán y reiniciarán ' + totalLeads +
                ' contactos actuales (se recomienda exportar respaldo JSON antes). Toca "Confirmar e Iniciar" para ejecutar.';
              elements.newCampaignFeedback.classList.remove('hidden');
            }
            if (elements.btnSubmitNewCampaign) {
              elements.btnSubmitNewCampaign.textContent = 'Confirmar e Iniciar';
            }
            return;
          }

          const descVal = elements.newCampaignDesc ? elements.newCampaignDesc.value : '';
          const cloneTpl = elements.newCampaignClone ? elements.newCampaignClone.checked : false;
          const prevCampaign = getActiveCampaign();
          const newId = 'camp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          const archResult = await archiveAndStartNewCampaign(newId, prevCampaign ? prevCampaign.name : 'Campaña previa');
          createCampaign(nameVal, descVal, cloneTpl, newId);

          if (archResult && Array.isArray(archResult.clearedReminderLeadIds) && callbacks.onCancelNativeReminder) {
            for (let i = 0; i < archResult.clearedReminderLeadIds.length; i += 1) {
              await callbacks.onCancelNativeReminder(archResult.clearedReminderLeadIds[i]);
            }
          }
          resetCampaignConfirm();
          elements.newCampaignModal.classList.add('hidden');
          await refreshFilterDropdown();
          await callbacks.onDataChanged();
        } catch (error) {
          resetCampaignConfirm();
          if (elements.newCampaignFeedback) {
            elements.newCampaignFeedback.textContent = error.message;
            elements.newCampaignFeedback.classList.remove('hidden');
          }
        }
      });
    }
  }

  return {
    bind,
    refreshFilterDropdown,
    openManualTagModal,
    openBulkSelectedTagModal,
    openBulkTagModal,
    removeTag,
    openNewCampaignModal,
    switchCampaign
  };
}
