const CHANNEL_STATS_KEY = 'crm_prospeccion_channels_v4';

export const WA_MONTHLY_LIMIT = 300;
export const WA_LINES = [
  { id: 'wa_1', label: 'WA 1' },
  { id: 'wa_2', label: 'WA 2' },
  { id: 'wa_3', label: 'WA 3' }
];

function padTwo(num) {
  return num < 10 ? '0' + num : String(num);
}

export function getMonthKey(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  return d.getFullYear() + '-' + padTwo(d.getMonth() + 1);
}

export function getDayKey(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  return d.getFullYear() + '-' + padTwo(d.getMonth() + 1) + '-' + padTwo(d.getDate());
}

function isValidWaLine(lineId) {
  return WA_LINES.some((item) => item.id === lineId);
}

function defaultChannelStore() {
  return {
    activeWaLine: 'wa_1',
    monthlyWa: {},
    dailyChannels: {}
  };
}

function normalizeMonthBucket(rawBucket) {
  const src = rawBucket && typeof rawBucket === 'object' ? rawBucket : {};
  const clean = {};
  WA_LINES.forEach((line) => {
    const val = Number(src[line.id]);
    clean[line.id] = !Number.isNaN(val) && val > 0 ? Math.floor(val) : 0;
  });
  return clean;
}

function normalizeDayBucket(rawBucket) {
  const src = rawBucket && typeof rawBucket === 'object' ? rawBucket : {};
  const igVal = Number(src.instagram);
  const callVal = Number(src.llamada);
  return {
    instagram: !Number.isNaN(igVal) && igVal > 0 ? Math.floor(igVal) : 0,
    llamada: !Number.isNaN(callVal) && callVal > 0 ? Math.floor(callVal) : 0
  };
}

function normalizeChannelStore(rawStore) {
  const src = rawStore && typeof rawStore === 'object' ? rawStore : {};
  const activeWaLine = isValidWaLine(src.activeWaLine) ? src.activeWaLine : 'wa_1';
  const monthlyWa = {};
  if (src.monthlyWa && typeof src.monthlyWa === 'object') {
    Object.keys(src.monthlyWa).forEach((mKey) => {
      if (mKey) {
        monthlyWa[String(mKey)] = normalizeMonthBucket(src.monthlyWa[mKey]);
      }
    });
  }
  const dailyChannels = {};
  if (src.dailyChannels && typeof src.dailyChannels === 'object') {
    Object.keys(src.dailyChannels).forEach((dKey) => {
      if (dKey) {
        dailyChannels[String(dKey)] = normalizeDayBucket(src.dailyChannels[dKey]);
      }
    });
  }
  return {
    activeWaLine: activeWaLine,
    monthlyWa: monthlyWa,
    dailyChannels: dailyChannels
  };
}

function readChannelStore() {
  if (typeof localStorage === 'undefined') {
    return defaultChannelStore();
  }
  try {
    const raw = localStorage.getItem(CHANNEL_STATS_KEY);
    if (!raw) {
      return defaultChannelStore();
    }
    return normalizeChannelStore(JSON.parse(raw));
  } catch (error) {
    return defaultChannelStore();
  }
}

function writeChannelStore(store) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(CHANNEL_STATS_KEY, JSON.stringify(normalizeChannelStore(store)));
  } catch (error) {
    return;
  }
}

export function getActiveWaLine() {
  return readChannelStore().activeWaLine;
}

export function setActiveWaLine(lineId) {
  if (!isValidWaLine(lineId)) {
    return getActiveWaLine();
  }
  const store = readChannelStore();
  store.activeWaLine = lineId;
  writeChannelStore(store);
  return lineId;
}

export function getWaLineLabel(lineId) {
  const found = WA_LINES.find((item) => item.id === lineId);
  return found ? found.label : 'WA';
}

export function incrementWaLineUsage(lineId, nowDate) {
  const store = readChannelStore();
  const targetLine = isValidWaLine(lineId) ? lineId : store.activeWaLine;
  const mKey = getMonthKey(nowDate);
  if (!store.monthlyWa[mKey]) {
    store.monthlyWa[mKey] = normalizeMonthBucket(null);
  }
  store.monthlyWa[mKey][targetLine] += 1;
  writeChannelStore(store);
  return store.monthlyWa[mKey][targetLine];
}

export function incrementDailyChannel(channelKey, nowDate) {
  if (channelKey !== 'instagram' && channelKey !== 'llamada') {
    return 0;
  }
  const store = readChannelStore();
  const dKey = getDayKey(nowDate);
  if (!store.dailyChannels[dKey]) {
    store.dailyChannels[dKey] = normalizeDayBucket(null);
  }
  store.dailyChannels[dKey][channelKey] += 1;
  writeChannelStore(store);
  return store.dailyChannels[dKey][channelKey];
}

export function getChannelSnapshot(nowDate) {
  const refDate = nowDate instanceof Date ? nowDate : new Date();
  const store = readChannelStore();
  const monthKey = getMonthKey(refDate);
  const dayKey = getDayKey(refDate);
  const monthBucket = store.monthlyWa[monthKey] ? store.monthlyWa[monthKey] : normalizeMonthBucket(null);
  const dayBucket = store.dailyChannels[dayKey] ? store.dailyChannels[dayKey] : normalizeDayBucket(null);
  const nearThreshold = Math.round(WA_MONTHLY_LIMIT * 0.8);

  const waLines = WA_LINES.map((line) => {
    const count = monthBucket[line.id] ? monthBucket[line.id] : 0;
    return {
      id: line.id,
      label: line.label,
      count: count,
      limit: WA_MONTHLY_LIMIT,
      pct: Math.min(100, Math.round((count / WA_MONTHLY_LIMIT) * 100)),
      isNearLimit: count >= nearThreshold,
      isAtLimit: count >= WA_MONTHLY_LIMIT
    };
  });

  return {
    activeWaLine: store.activeWaLine,
    monthKey: monthKey,
    dayKey: dayKey,
    waLimit: WA_MONTHLY_LIMIT,
    waLines: waLines,
    todayInstagram: dayBucket.instagram,
    todayCalls: dayBucket.llamada
  };
}

export function exportChannelStats() {
  return readChannelStore();
}

export function mergeChannelStats(incomingStats) {
  if (!(incomingStats && typeof incomingStats === 'object')) {
    return readChannelStore();
  }
  const current = readChannelStore();
  const incoming = normalizeChannelStore(incomingStats);

  Object.keys(incoming.monthlyWa).forEach((mKey) => {
    const curBucket = current.monthlyWa[mKey] ? current.monthlyWa[mKey] : normalizeMonthBucket(null);
    const incBucket = incoming.monthlyWa[mKey];
    WA_LINES.forEach((line) => {
      curBucket[line.id] = Math.max(curBucket[line.id], incBucket[line.id]);
    });
    current.monthlyWa[mKey] = curBucket;
  });

  Object.keys(incoming.dailyChannels).forEach((dKey) => {
    const curDay = current.dailyChannels[dKey] ? current.dailyChannels[dKey] : normalizeDayBucket(null);
    const incDay = incoming.dailyChannels[dKey];
    curDay.instagram = Math.max(curDay.instagram, incDay.instagram);
    curDay.llamada = Math.max(curDay.llamada, incDay.llamada);
    current.dailyChannels[dKey] = curDay;
  });

  writeChannelStore(current);
  return current;
}

const IG_FIX_20261122_KEY = 'crm_ig_fix_20261122_done';

export function applyOneTimeIgCounterFix20261122() {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    if (localStorage.getItem(IG_FIX_20261122_KEY) === '1') {
      return false;
    }
    const store = readChannelStore();
    const targetDay = '2026-11-22';
    if (store.dailyChannels[targetDay] && store.dailyChannels[targetDay].instagram > 6) {
      store.dailyChannels[targetDay].instagram = 6;
      writeChannelStore(store);
    }
    localStorage.setItem(IG_FIX_20261122_KEY, '1');
    return true;
  } catch (error) {
    return false;
  }
}
