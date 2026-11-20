import { matchesQueueFilter, sortSeguimientoLeads, getInterestTagsCatalog } from '../services/phase-engine.js';
import { getActiveWaLine, getWaLineLabel } from '../services/channel-service.js';
import { matchesRubroAndCampaign } from './campaign-controller.js';

const BATCH_SIZE = 30;

function matchesSearchQuery(lead, rawQuery) {
  const query = rawQuery ? String(rawQuery).trim().toLowerCase() : '';
  if (!query) {
    return true;
  }
  const nameMatch = lead.name ? lead.name.toLowerCase().indexOf(query) !== -1 : false;
  if (nameMatch) {
    return true;
  }
  const cleanIgQuery = query.replace(/^@+/, '');
  if (cleanIgQuery && lead.instagram && lead.instagram.indexOf(cleanIgQuery) !== -1) {
    return true;
  }
  const digitsQuery = query.replace(/\D/g, '');
  if (digitsQuery.length > 0 && lead.phone) {
    return String(lead.phone).indexOf(digitsQuery) !== -1;
  }
  return false;
}

export function createListRenderer(elements, state, getBaseHandlers) {
  let currentFiltered = [];
  let renderedCount = 0;
  let loadMoreBtn = null;
  let cachedModules = null;

  async function ensureModules() {
    if (cachedModules) {
      return cachedModules;
    }
    const results = await Promise.all([
      import('./lead-card.js'),
      import('../services/whatsapp-service.js'),
      import('../services/template-service.js')
    ]);
    cachedModules = {
      cardMod: results[0],
      waMod: results[1],
      tplMod: results[2]
    };
    return cachedModules;
  }

  function removeLoadMoreButton() {
    if (loadMoreBtn && loadMoreBtn.parentNode) {
      loadMoreBtn.parentNode.removeChild(loadMoreBtn);
    }
    loadMoreBtn = null;
  }

  async function renderNextBatch() {
    if (renderedCount >= currentFiltered.length) {
      removeLoadMoreButton();
      return;
    }

    const mods = await ensureModules();
    const tagLabelsMap = {};
    mods.tplMod.getTemplates('all').forEach((tpl) => {
      tagLabelsMap[tpl.id] = tpl.label;
    });
    const interestCatalog = getInterestTagsCatalog();
    const activeWaLineLabel = getWaLineLabel(getActiveWaLine());

    const baseHandlers = getBaseHandlers(mods.waMod, tagLabelsMap);
    const endIdx = Math.min(renderedCount + BATCH_SIZE, currentFiltered.length);
    const fragment = document.createDocumentFragment();
    const selectedSet = new Set(state.selectedIds);

    for (let i = renderedCount; i < endIdx; i += 1) {
      const lead = currentFiltered[i];
      const handlers = Object.assign({}, baseHandlers, {
        interestCatalog: interestCatalog,
        activeWaLineLabel: activeWaLineLabel,
        isSelectionActive: () => state.selectionMode,
        isSelectionMode: state.selectionMode,
        isSelected: selectedSet.has(lead.id)
      });
      fragment.appendChild(mods.cardMod.createLeadCard(lead, handlers));
    }

    removeLoadMoreButton();
    elements.leadsList.appendChild(fragment);
    renderedCount = endIdx;

    const remaining = currentFiltered.length - renderedCount;
    if (remaining > 0) {
      loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.className = 'btn-secondary btn-full load-more-btn';
      loadMoreBtn.textContent = 'Cargar más prospectos (' + remaining + ' restantes)';
      loadMoreBtn.addEventListener('click', () => {
        renderNextBatch();
      });
      elements.leadsList.appendChild(loadMoreBtn);
    }
  }

  function syncSelectionUi() {
    const selectedSet = new Set(state.selectedIds);
    const cards = elements.leadsList.querySelectorAll('.lead-card');
    cards.forEach((card) => {
      const isSel = state.selectionMode && selectedSet.has(card.dataset.id);
      card.classList.toggle('lead-card-selected', isSel);
      const check = card.querySelector('.select-check');
      if (check) {
        check.classList.toggle('hidden', !state.selectionMode);
        check.classList.toggle('checked', isSel);
        check.textContent = isSel ? '✓' : '';
      }
    });
  }

  function filterAndSortLeads(allLeads) {
    const now = Date.now();
    const filtered = allLeads.filter((lead) => {
      const st = lead.stage ? lead.stage : lead.status;
      const statusOk = state.filter === 'todos' ? true : st === state.filter;
      if (!statusOk) {
        return false;
      }
      if (!matchesQueueFilter(lead, state.queueFilter, now)) {
        return false;
      }
      if (!matchesRubroAndCampaign(lead, state)) {
        return false;
      }
      return matchesSearchQuery(lead, state.searchQuery);
    });

    const isSeguimientoView = state.filter === 'seguimiento' ? true : state.queueFilter === 'seg_urgente';
    if (isSeguimientoView) {
      return sortSeguimientoLeads(filtered, now);
    }
    return filtered;
  }

  async function render(allLeads) {
    currentFiltered = filterAndSortLeads(allLeads);
    renderedCount = 0;
    removeLoadMoreButton();
    elements.leadsList.innerHTML = '';

    if (currentFiltered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      const hasQuery = Boolean(state.searchQuery && state.searchQuery.trim().length > 0);
      empty.textContent = hasQuery
        ? 'No se encontraron prospectos para "' + state.searchQuery.trim() + '".'
        : 'No hay prospectos en esta vista con los filtros actuales.';
      elements.leadsList.appendChild(empty);
      return;
    }

    await renderNextBatch();
  }

  function getVisibleIds() {
    return currentFiltered.map((lead) => lead.id);
  }

  async function focusLeadById(leadId) {
    if (!leadId) {
      return false;
    }
    const targetIdx = currentFiltered.findIndex((lead) => lead.id === leadId);
    if (targetIdx === -1) {
      return false;
    }
    while (renderedCount <= targetIdx && renderedCount < currentFiltered.length) {
      await renderNextBatch();
    }
    const cardEl = elements.leadsList.querySelector('[data-id="' + leadId + '"]');
    if (!cardEl) {
      return false;
    }
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cardEl.classList.add('lead-card-highlight');
    setTimeout(() => {
      cardEl.classList.remove('lead-card-highlight');
    }, 2200);
    return true;
  }

  return {
    render: render,
    getVisibleIds: getVisibleIds,
    focusLeadById: focusLeadById,
    syncSelectionUi: syncSelectionUi
  };
}
