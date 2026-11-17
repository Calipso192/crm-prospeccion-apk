import { buildDashboardSnapshot } from '../services/phase-engine.js';
import { evaluateBackupHealth } from '../services/backup-service.js';

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text !== undefined && text !== null) {
    el.textContent = String(text);
  }
  return el;
}

function buildQueueBlock(queue, handlers) {
  const card = createEl('section', 'dash-card');
  const header = createEl('div', 'dash-card-header');
  header.appendChild(createEl('h2', 'dash-card-title', '1. Cola de Pendientes del Día'));
  const totalPending = queue.seguimientoUrgent + queue.nuevosSinFase1 + queue.listosFase2 + queue.listosFase3 + queue.listosDescartar;
  header.appendChild(createEl('span', 'badge', totalPending + ' acciones'));
  card.appendChild(header);

  const grid = createEl('div', 'dash-queue-grid');
  const items = [
    {
      key: 'seg_urgente',
      status: 'seguimiento',
      count: queue.seguimientoUrgent,
      label: 'Seguimientos hoy / vencidos',
      sub: queue.seguimientoOverdue > 0 ? queue.seguimientoOverdue + ' vencidos' : 'Agenda al día',
      tone: queue.seguimientoOverdue > 0 ? 'tone-danger' : 'tone-warning'
    },
    {
      key: 'nuevo_f1',
      status: 'nuevo',
      count: queue.nuevosSinFase1,
      label: 'Nuevos sin Fase 1',
      sub: 'Listos 1er mensaje',
      tone: 'tone-info'
    },
    {
      key: 'listo_f2',
      status: 'contactado',
      count: queue.listosFase2,
      label: 'Listos para Fase 2',
      sub: '+3 días sin respuesta',
      tone: 'tone-primary'
    },
    {
      key: 'listo_f3',
      status: 'contactado',
      count: queue.listosFase3,
      label: 'Listos para Fase 3',
      sub: '+4 días desde Fase 2',
      tone: 'tone-purple'
    },
    {
      key: 'listo_descartar',
      status: 'contactado',
      count: queue.listosDescartar,
      label: 'Listos para Descartar',
      sub: '+24h tras Fase 3',
      tone: 'tone-muted'
    }
  ];

  items.forEach((item) => {
    const btn = createEl('button', 'dash-queue-btn ' + item.tone);
    btn.type = 'button';
    btn.appendChild(createEl('span', 'dash-queue-count', item.count));
    btn.appendChild(createEl('span', 'dash-queue-label', item.label));
    btn.appendChild(createEl('span', 'dash-queue-sub', item.sub));
    btn.addEventListener('click', () => {
      if (handlers.onSelectQueueFilter) {
        handlers.onSelectQueueFilter(item.key, item.status);
      }
    });
    grid.appendChild(btn);
  });

  card.appendChild(grid);
  return card;
}

function buildFunnelBlock(funnel, campaignState, handlers) {
  const card = createEl('section', 'dash-card');
  const header = createEl('div', 'dash-card-header');
  header.appendChild(createEl('h2', 'dash-card-title', '2. Embudo de Campaña Activa'));
  const btnNewCamp = createEl('button', 'btn-primary btn-compact', '+ Nueva Campaña');
  btnNewCamp.type = 'button';
  btnNewCamp.addEventListener('click', () => {
    if (handlers.onOpenNewCampaign) {
      handlers.onOpenNewCampaign();
    }
  });
  header.appendChild(btnNewCamp);
  card.appendChild(header);

  const campRow = createEl('div', 'dash-campaign-row');
  const select = createEl('select', 'dash-campaign-select');
  select.setAttribute('aria-label', 'Seleccionar campaña activa');
  const list = Array.isArray(campaignState.campaigns) ? campaignState.campaigns : [];
  list.forEach((camp) => {
    const opt = document.createElement('option');
    opt.value = camp.id;
    opt.textContent = camp.name;
    if (camp.id === campaignState.activeCampaignId) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    if (handlers.onSwitchCampaign) {
      handlers.onSwitchCampaign(select.value);
    }
  });
  campRow.appendChild(select);
  card.appendChild(campRow);

  const stages = [
    { status: 'nuevo', label: 'Nuevos', count: funnel.nuevo, cls: 'stage-nuevo' },
    { status: 'contactado', label: 'Contactado (F1: ' + funnel.contactadoF1 + ' · F2: ' + funnel.contactadoF2 + ' · F3: ' + funnel.contactadoF3 + ')', count: funnel.contactadoTotal, cls: 'stage-contactado' },
    { status: 'seguimiento', label: 'Seguimiento vivo', count: funnel.seguimiento, cls: 'stage-seguimiento' },
    { status: 'vendido', label: 'Vendidos', count: funnel.vendido, cls: 'stage-vendido' },
    { status: 'descartado', label: 'Descartados', count: funnel.descartado, cls: 'stage-descartado' }
  ];

  const listWrap = createEl('div', 'dash-funnel-list');
  const baseTotal = funnel.total > 0 ? funnel.total : 1;

  stages.forEach((st) => {
    const rowBtn = createEl('button', 'dash-funnel-row');
    rowBtn.type = 'button';
    const topLine = createEl('div', 'dash-funnel-top');
    topLine.appendChild(createEl('span', 'dash-funnel-name', st.label));
    topLine.appendChild(createEl('strong', 'dash-funnel-val', st.count));
    rowBtn.appendChild(topLine);

    const track = createEl('div', 'dash-bar-track');
    const fill = createEl('div', 'dash-bar-fill ' + st.cls);
    const pct = Math.min(100, Math.round((st.count / baseTotal) * 100));
    fill.style.width = pct + '%';
    track.appendChild(fill);
    rowBtn.appendChild(track);

    rowBtn.addEventListener('click', () => {
      if (handlers.onSelectStageFilter) {
        handlers.onSelectStageFilter(st.status);
      }
    });
    listWrap.appendChild(rowBtn);
  });

  card.appendChild(listWrap);
  return card;
}

function buildSalesAndHeatBlock(sales, handlers) {
  const card = createEl('section', 'dash-card');
  const header = createEl('div', 'dash-card-header');
  header.appendChild(createEl('h2', 'dash-card-title', '3. Termómetro de Calientes y Ventas'));
  const btnGear = createEl('button', 'btn-secondary btn-compact', '⚙ Etiquetas');
  btnGear.type = 'button';
  btnGear.setAttribute('aria-label', 'Personalizar etiquetas de interés');
  btnGear.addEventListener('click', () => {
    if (handlers.onOpenInterestManager) {
      handlers.onOpenInterestManager();
    }
  });
  header.appendChild(btnGear);
  card.appendChild(header);

  const kpiGrid = createEl('div', 'dash-kpi-grid');
  const kpis = [
    { label: 'Facturado', val: 'S/ ' + sales.totalRevenue.toFixed(2), cls: 'kpi-revenue' },
    { label: 'Ventas cerradas', val: String(sales.ventasCount), cls: 'kpi-sales' },
    { label: 'Tasa respuesta', val: sales.responseRate + '%', cls: 'kpi-rate' },
    { label: 'Tasa cierre', val: sales.closeRate + '%', cls: 'kpi-rate' }
  ];
  kpis.forEach((k) => {
    const box = createEl('div', 'dash-kpi-box ' + k.cls);
    box.appendChild(createEl('span', 'dash-kpi-val', k.val));
    box.appendChild(createEl('span', 'dash-kpi-label', k.label));
    kpiGrid.appendChild(box);
  });
  card.appendChild(kpiGrid);

  const heatChips = createEl('div', 'dash-heat-chips');
  const catalog = Array.isArray(sales.interestCatalog) ? sales.interestCatalog : [];
  catalog.forEach((tag) => {
    const count = sales.interestCounts[tag.id] ? sales.interestCounts[tag.id] : 0;
    const chip = createEl('button', 'dash-heat-chip heat-' + tag.tone);
    chip.type = 'button';
    chip.textContent = tag.label + ' (' + count + ')';
    chip.addEventListener('click', () => {
      if (handlers.onSelectQueueFilter) {
        handlers.onSelectQueueFilter(tag.id, 'todos');
      }
    });
    heatChips.appendChild(chip);
  });
  card.appendChild(heatChips);
  return card;
}

function buildRubroAndOpsBlock(rubroStats, backupMeta, handlers) {
  const card = createEl('section', 'dash-card');
  const header = createEl('div', 'dash-card-header');
  header.appendChild(createEl('h2', 'dash-card-title', '4. Efectividad por Rubro y Carga Rápida'));
  card.appendChild(header);

  const table = createEl('div', 'dash-rubro-list');
  rubroStats.forEach((r) => {
    const row = createEl('div', 'dash-rubro-row');
    row.appendChild(createEl('span', 'dash-rubro-name', r.label));
    const metrics = r.total + ' leads · ' + r.sold + ' ventas (' + r.conversionRate + '%)';
    row.appendChild(createEl('span', 'dash-rubro-meta', metrics));
    table.appendChild(row);
  });
  card.appendChild(table);

  const health = evaluateBackupHealth(backupMeta);
  const backupBanner = createEl('div', health.needsExport ? 'dash-backup-bar backup-alert' : 'dash-backup-bar');
  backupBanner.appendChild(createEl('span', 'dash-backup-text', health.statusLabel));
  const btnExport = createEl('button', health.needsExport ? 'btn-warning btn-compact' : 'btn-secondary btn-compact', 'Exportar JSON');
  btnExport.type = 'button';
  btnExport.addEventListener('click', () => {
    if (handlers.onQuickExportBackup) {
      handlers.onQuickExportBackup();
    }
  });
  backupBanner.appendChild(btnExport);
  card.appendChild(backupBanner);

  const btnBulk = createEl('button', 'btn-whatsapp btn-full', '+ Pegar Lote Diario de Contactos Nuevos');
  btnBulk.type = 'button';
  btnBulk.addEventListener('click', () => {
    if (handlers.onOpenBulkPaste) {
      handlers.onOpenBulkPaste();
    }
  });
  card.appendChild(btnBulk);

  return card;
}

export function renderDashboardView(containerEl, leads, campaignState, backupMeta, handlers) {
  if (!containerEl) {
    return;
  }
  const snapshot = buildDashboardSnapshot(leads, Date.now());
  containerEl.innerHTML = '';
  containerEl.appendChild(buildQueueBlock(snapshot.queue, handlers));
  containerEl.appendChild(buildFunnelBlock(snapshot.funnel, campaignState, handlers));
  containerEl.appendChild(buildSalesAndHeatBlock(snapshot.sales, handlers));
  containerEl.appendChild(buildRubroAndOpsBlock(snapshot.rubroStats, backupMeta, handlers));
}
