import { matchesQueueFilter, sortSeguimientoLeads } from '../services/phase-engine.js';
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
  const digitsQuery = query.replace(/\D/g, '');
  if (digitsQuery.length > 0) {
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

    const baseHandlers = getBaseHandlers(mods.waMod, tagLabelsMap);
    const endIdx = Math.min(renderedCount + BATCH_SIZE, currentFiltered.length);
    const fragment = document.createDocumentFragment();

    for (let i = renderedCount; i < endIdx; i += 1) {
      const lead = currentFiltered[i];
      const handlers = Object.assign({}, baseHandlers, {
        isSelectionMode: state.selectionMode,
        isSelected: state.selectedIds.indexOf(lead.id) !== -1
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

  function filterAndSortLeads(allLeads) {
    const now = Date.now();
    const filtered = allLeads.filter((lead) => {
      const statusOk = state.filter === 'todos' ? true : lead.status === state.filter;
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
        : 'No hay prospectos que coincidan con los filtros seleccionados.';
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
    focusLeadById: focusLeadById
  };
}
