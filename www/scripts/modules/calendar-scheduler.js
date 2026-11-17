import {
  getUpcomingDays,
  buildReminderIso,
  buildRelativeHoursIso,
  parseReminderParts,
  formatReminderLabel,
  openGoogleCalendar
} from '../services/reminder-service.js';

export function createCalendarScheduler(elements, getLeadContext) {
  const schedulerState = {
    dateStr: '',
    hour: 10,
    minute: 0
  };

  function renderDays() {
    elements.dayChips.innerHTML = '';
    getUpcomingDays(7).forEach((day) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-action';
      btn.dataset.date = day.dateStr;
      btn.textContent = day.label;
      elements.dayChips.appendChild(btn);
    });
  }

  function syncUi() {
    elements.customDate.value = schedulerState.dateStr;
    elements.dayChips.querySelectorAll('[data-date]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.date === schedulerState.dateStr);
    });
    elements.hourChips.querySelectorAll('[data-hour]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.hour) === schedulerState.hour);
    });
    elements.minuteChips.querySelectorAll('[data-minute]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.minute) === schedulerState.minute);
    });
    const iso = buildReminderIso(schedulerState.dateStr, schedulerState.hour, schedulerState.minute);
    const label = formatReminderLabel(iso, elements.reasonInput.value);
    elements.preview.textContent = label ? label : 'Sin fecha seleccionada';
    elements.btnClear.classList.toggle('hidden', !schedulerState.dateStr);
  }

  function applyIsoToState(isoStr) {
    const parsed = parseReminderParts(isoStr);
    if (!parsed) {
      return;
    }
    schedulerState.dateStr = parsed.dateStr;
    schedulerState.hour = parsed.hour;
    schedulerState.minute = parsed.minute;
    syncUi();
  }

  function loadFromLead(lead) {
    renderDays();
    schedulerState.dateStr = '';
    schedulerState.hour = 10;
    schedulerState.minute = 0;
    if (lead) {
      elements.reasonInput.value = lead.reminderReason ? lead.reminderReason : '';
      const parsed = parseReminderParts(lead.reminderAt);
      if (parsed) {
        schedulerState.dateStr = parsed.dateStr;
        schedulerState.hour = parsed.hour;
        schedulerState.minute = parsed.minute;
      }
    } else {
      elements.reasonInput.value = '';
    }
    syncUi();
  }

  function reset() {
    schedulerState.dateStr = '';
    schedulerState.hour = 10;
    schedulerState.minute = 0;
    elements.reasonInput.value = '';
    syncUi();
  }

  function getValues() {
    return {
      reminderAt: buildReminderIso(schedulerState.dateStr, schedulerState.hour, schedulerState.minute),
      reminderReason: elements.reasonInput.value ? elements.reasonInput.value.trim() : ''
    };
  }

  function bind() {
    if (elements.quickHoursChips) {
      elements.quickHoursChips.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-hours-ahead]');
        if (!btn) {
          return;
        }
        const hours = Number(btn.dataset.hoursAhead);
        const iso = buildRelativeHoursIso(hours);
        applyIsoToState(iso);
      });
    }

    elements.dayChips.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-date]');
      if (btn) {
        schedulerState.dateStr = btn.dataset.date;
        syncUi();
      }
    });

    elements.customDate.addEventListener('change', () => {
      schedulerState.dateStr = elements.customDate.value;
      syncUi();
    });

    elements.hourChips.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-hour]');
      if (!btn) {
        return;
      }
      schedulerState.hour = Number(btn.dataset.hour);
      if (!schedulerState.dateStr) {
        schedulerState.dateStr = getUpcomingDays(2)[0].dateStr;
      }
      syncUi();
    });

    elements.minuteChips.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-minute]');
      if (btn) {
        schedulerState.minute = Number(btn.dataset.minute);
        syncUi();
      }
    });

    elements.reasonChips.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-reason]');
      if (btn) {
        elements.reasonInput.value = btn.dataset.reason;
        syncUi();
      }
    });

    elements.reasonInput.addEventListener('input', syncUi);
    elements.btnClear.addEventListener('click', reset);

    elements.btnOpenCalendar.addEventListener('click', () => {
      const ctx = getLeadContext();
      const vals = getValues();
      openGoogleCalendar({
        name: ctx.name,
        phone: ctx.phone,
        notes: ctx.notes,
        reminderAt: vals.reminderAt,
        reminderReason: vals.reminderReason
      }, vals.reminderAt, vals.reminderReason);
    });
  }

  return {
    bind: bind,
    loadFromLead: loadFromLead,
    reset: reset,
    getValues: getValues
  };
}
