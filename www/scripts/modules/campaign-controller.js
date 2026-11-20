import {
  addTagToLead,
  removeTagFromLead,
  bulkUpdateByIds,
  enrollLeadsInCampaign
} from '../services/db-service.js';
import {
  hasBoughtInAnyCampaign,
  applySentTagToCampaignState,
  createDefaultCampaignState
} from '../services/lead-schema.js';
import {
  RETROACTIVE_DAYS,
  computeRetroactiveTimestamp
} from '../services/phase-engine.js';
import {
  createCampaign,
  getActiveCampaignId,
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
      elements.tagPickerTitle.textContent = 'Asignar plantilla';
    }
    elements.tagPickerLeadName.textContent = 'Prospecto: ' + lead.name;
    await renderManualTagOptions(lead, elements.tagPickerList, async (targetLead, tpl) => {
      elements.tagPickerModal.classList.add('hidden');
      const sentAt = computeRetroactiveTimestamp(selectedRetroDays);
      await addTagToLead(targetLead.id, getActiveCampaignId(), {
        id: tpl.id,
        label: tpl.label,
        phase: Number(tpl.phase) > 0 ? Number(tpl.phase) : 0,
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
    const activeCid = getActiveCampaignId();
    await renderManualTagOptions(dummyLead, elements.tagPickerList, async (ignoredLead, tpl) => {
      elements.tagPickerModal.classList.add('hidden');
      const sentAt = computeRetroactiveTimestamp(selectedRetroDays);
      await bulkUpdateByIds(ids, (record, now) => {
        if (!record.campaignStates[activeCid]) {
          record.campaignStates[activeCid] = createDefaultCampaignState('nuevo', now);
        }
        const cs = record.campaignStates[activeCid];
        if (cs.sentTags.some((t) => t.id === tpl.id)) {
          return false;
        }
        applySentTagToCampaignState(cs, {
          id: tpl.id,
          label: tpl.label,
          phase: Number(tpl.phase) > 0 ? Number(tpl.phase) : 0
        }, sentAt, true);
        cs.updatedAt = now;
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
    await removeTagFromLead(lead.id, getActiveCampaignId(), tag.id);
    await callbacks.onDataChanged();
  }

  function openNewCampaignModal() {
    if (!elements.newCampaignModal) {
      return;
    }
    if (elements.newCampaignForm) {
      elements.newCampaignForm.reset();
    }
    if (elements.newCampaignFeedback) {
      elements.newCampaignFeedback.classList.add('hidden');
    }
    const emptyRadio = elements.newCampaignForm
      ? elements.newCampaignForm.querySelector('input[name="new-campaign-mode"][value="empty"]')
      : null;
    if (emptyRadio) {
      emptyRadio.checked = true;
    }
    const masterLeads = callbacks.getMasterLeads ? callbacks.getMasterLeads() : [];
    const buyersCount = masterLeads.filter((item) => hasBoughtInAnyCampaign(item, '')).length;
    if (elements.campModeAllCount) {
      elements.campModeAllCount.textContent = String(masterLeads.length);
    }
    if (elements.campModeBuyersCount) {
      elements.campModeBuyersCount.textContent = String(buyersCount);
    }
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
        if (!btn) { return; }
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
      if (!btn) { return; }
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
        elements.newCampaignModal.classList.add('hidden');
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
          const descVal = elements.newCampaignDesc ? elements.newCampaignDesc.value : '';
          const cloneTpl = elements.newCampaignClone ? elements.newCampaignClone.checked : false;
          const modeInput = elements.newCampaignForm.querySelector('input[name="new-campaign-mode"]:checked');
          const mode = modeInput ? modeInput.value : 'empty';
          const newId = 'camp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

          createCampaign(nameVal, descVal, cloneTpl, newId);
          const enrollRes = await enrollLeadsInCampaign(newId, mode);

          elements.newCampaignModal.classList.add('hidden');
          await refreshFilterDropdown();
          await callbacks.onDataChanged();
          if (callbacks.onNotify) {
            const count = enrollRes && enrollRes.enrolledCount ? enrollRes.enrolledCount : 0;
            callbacks.onNotify('Campaña "' + nameVal + '" creada con ' + count + ' contactos iniciales.');
          }
        } catch (error) {
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
