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

function buildChannelBlock(channelSnapshot, handlers) {
  const snap = channelSnapshot ? channelSnapshot : {
    activeWaLine: 'wa_1', waLines: [], todayInstagram: 0, todayCalls: 0
  };
  const card = createEl('section', 'dash-card');
  const header = createEl('div', 'dash-card-header');
  header.appendChild(createEl('h2', 'dash-card-title', '1. Canales y Cuotas'));
  const activeObj = snap.waLines.find((l) => l.id === snap.activeWaLine);
  const activeLabel = activeObj ? activeObj.label : 'WA 1';
  header.appendChild(createEl('span', 'badge', 'Línea activa: ' + activeLabel));
  card.appendChild(header);

  const waGrid = createEl('div', 'wa-lines-grid');
  snap.waLines.forEach((line) => {
    const isActive = line.id === snap.activeWaLine;
    let cls = 'wa-line-btn';
    if (isActive) { cls += ' active'; }
    if (line.isAtLimit) { cls += ' line-full'; }
    else if (line.isNearLimit) { cls += ' line-warn'; }

    const btn = createEl('button', cls);
    btn.type = 'button';
    const top = createEl('div', 'wa-line-top');
    top.appendChild(createEl('span', '', line.label));
    top.appendChild(createEl('span', 'wa-line-quota', line.count + '/' + line.limit));
    btn.appendChild(top);

    const bar = createEl('div', 'wa-line-bar');
    const fill = createEl('div', 'wa-line-fill');
    fill.style.width = line.pct + '%';
    bar.appendChild(fill);
    btn.appendChild(bar);

    btn.addEventListener('click', () => {
      if (handlers.onSelectWaLine) {
        handlers.onSelectWaLine(line.id);
      }
    });
    waGrid.appendChild(btn);
  });
  card.appendChild(waGrid);

  const dailyRow = createEl('div', 'channel-daily-row');
  const igPill = createEl('div', 'channel-daily-pill channel-daily-ig');
  igPill.appendChild(createEl('span', '', 'Instagram DM hoy'));
  igPill.appendChild(createEl('strong', '', snap.todayInstagram));
  dailyRow.appendChild(igPill);

  const callPill = createEl('div', 'channel-daily-pill channel-daily-call');
  callPill.appendChild(createEl('span', '', 'Llamadas hoy'));
  callPill.appendChild(createEl('strong', '', snap.todayCalls));
  dailyRow.appendChild(callPill);
  card.appendChild(dailyRow);

  return card;
}

function buildQueueBlock(queue, handlers) {
  const card = createEl('section', 'dash-card');
  const header = createEl('div', 'dash-card-header');
  header.appendChild(createEl('h2', 'dash-card-title', '2. Cola de Pendientes del Día'));
  const totalPending = queue.seguimientoUrgent + queue.nuevosPendientes + queue.contactadosTriage + queue.sinWhatsappAlt;
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
      key: 'nuevo_pendiente',
      status: 'nuevo',
      count: queue.nuevosPendientes,
      label: 'Nuevos por contactar',
      sub: '1er disparo pendiente',
      tone: 'tone-info'
    },
    {
      key: 'contactado_triage',
      status: 'contactado',
      count: queue.contactadosTriage,
      label: 'Contactados en triage',
      sub: 'Clasificar respuesta en 1 toque',
      tone: 'tone-primary'
    },
    {
      key: 'sin_whatsapp_alt',
      status: 'sin_whatsapp',
      count: queue.sinWhatsappAlt,
      label: 'Sin WhatsApp',
      sub: 'Abordar por IG DM o Llamada',
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
  header.appendChild(createEl('h2', 'dash-card-title', '3. Embudo de Campaña'));

  const list = Array.isArray(campaignState.campaigns) ? campaignState.campaigns : [];
  const activeCamp = campaignState.activeCampaign
    ? campaignState.activeCampaign
    : list.find((c) => c.id === campaignState.activeCampaignId);
  const isClosed = Boolean(activeCamp && activeCamp.status === 'cerrada');

  const actionsWrap = createEl('div', 'dash-camp-actions');
  if (activeCamp) {
    const btnToggle = createEl('button', 'btn-secondary btn-compact', isClosed ? 'Reabrir' : 'Cerrar');
    btnToggle.type = 'button';
    btnToggle.addEventListener('click', () => {
      if (handlers.onToggleCampaignStatus) {
        handlers.onToggleCampaignStatus(activeCamp);
      }
    });
    actionsWrap.appendChild(btnToggle);
  }
  const btnNewCamp = createEl('button', 'btn-primary btn-compact', '+ Nueva');
  btnNewCamp.type = 'button';
  btnNewCamp.addEventListener('click', () => {
    if (handlers.onOpenNewCampaign) {
      handlers.onOpenNewCampaign();
    }
  });
  actionsWrap.appendChild(btnNewCamp);
  header.appendChild(actionsWrap);
  card.appendChild(header);

  const campRow = createEl('div', 'dash-campaign-row');
  const select = createEl('select', 'dash-campaign-select');
  select.setAttribute('aria-label', 'Seleccionar campaña activa');
  list.forEach((camp) => {
    const opt = document.createElement('option');
    opt.value = camp.id;
    opt.textContent = camp.status === 'cerrada' ? camp.name + ' (Cerrada)' : camp.name;
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
  const statusPillCls = isClosed ? 'camp-status-pill camp-status-cerrada' : 'camp-status-pill camp-status-activa';
  campRow.appendChild(createEl('span', statusPillCls, isClosed ? 'Cerrada' : 'Activa'));
  card.appendChild(campRow);

  if (isClosed) {
    card.appendChild(createEl(
      'p',
      'closed-camp-banner',
      'Campaña cerrada: sus métricas permanecen intactas. Toca "Reabrir" para volver a prospectar en ella.'
    ));
  }

  const contactSub = 'WA: ' + funnel.contactadoWa + ' · IG: ' + funnel.contactadoIg + ' · Tel: ' + funnel.contactadoCall;
  const discardLabel = funnel.descartadoBotMeta > 0
    ? 'Descartados (Bot Meta: ' + funnel.descartadoBotMeta + ')'
    : 'Descartados';

  const stages = [
    { status: 'nuevo', label: 'Nuevos', count: funnel.nuevo, cls: 'stage-nuevo' },
    { status: 'contactado', label: 'Contactado (' + contactSub + ')', count: funnel.contactado, cls: 'stage-contactado' },
    { status: 'seguimiento', label: 'Seguimiento vivo', count: funnel.seguimiento, cls: 'stage-seguimiento' },
    { status: 'vendido', label: 'Vendidos', count: funnel.vendido, cls: 'stage-vendido' },
    { status: 'descartado', label: discardLabel, count: funnel.descartado, cls: 'stage-descartado' }
  ];
  if (funnel.sinWhatsapp > 0) {
    stages.push({ status: 'sin_whatsapp', label: 'Sin WhatsApp', count: funnel.sinWhatsapp, cls: 'stage-sin_whatsapp' });
  }

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
    const pct = Math.min(100, Math.round((st.count / baseTotal) * 100));
    const fill = createEl('div', pct === 0 ? 'dash-bar-fill bar-empty ' + st.cls : 'dash-bar-fill ' + st.cls);
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
  header.appendChild(createEl('h2', 'dash-card-title', '4. Termómetro de Calientes y Ventas'));
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
  header.appendChild(createEl('h2', 'dash-card-title', '5. Efectividad por Rubro y Carga Rápida'));
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

export function renderDashboardView(containerEl, leads, campaignState, backupMeta, channelSnapshot, handlers) {
  if (!containerEl) {
    return;
  }
  const snapshot = buildDashboardSnapshot(leads, Date.now());
  containerEl.innerHTML = '';
  containerEl.appendChild(buildChannelBlock(channelSnapshot, handlers));
  containerEl.appendChild(buildQueueBlock(snapshot.queue, handlers));
  containerEl.appendChild(buildFunnelBlock(snapshot.funnel, campaignState, handlers));
  containerEl.appendChild(buildSalesAndHeatBlock(snapshot.sales, handlers));
  containerEl.appendChild(buildRubroAndOpsBlock(snapshot.rubroStats, backupMeta, handlers));
}
