(() => {
  const pad2 = (value) => String(value).padStart(2, '0');

  const toIsoDate = (year, month, day) => {
    return `${year}-${pad2(month)}-${pad2(day)}`;
  };

  const isValidDate = (year, month, day) => {
    if (!year || !month || !day) return false;
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  };

  const normalizeIsoDates = (dates) => {
    const list = Array.isArray(dates) ? dates : [];
    const unique = new Set();
    for (const value of list) {
      const trimmed = String(value || '').trim();
      const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) continue;
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (!isValidDate(year, month, day)) continue;
      unique.add(toIsoDate(year, month, day));
    }
    return Array.from(unique).sort();
  };

  const formatDisplayDate = (isoDate) => {
    const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    return `${match[1]}/${match[2]}/${match[3]}`;
  };

  const parsePerformanceDates = (raw, opts = {}) => {
    const text = String(raw ?? '').replace(/\u3000/g, ' ').trim();
    if (!text) return { isoDates: [], displayDates: [] };

    const tokens = text.split(/[,\s、]+/).map((t) => t.trim()).filter(Boolean);
    const results = [];
    let currentYear = null;
    let currentMonth = null;

    for (const token of tokens) {
      const ymdMatch = token.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
      if (ymdMatch) {
        const year = Number(ymdMatch[1]);
        const month = Number(ymdMatch[2]);
        const day = Number(ymdMatch[3]);
        if (!isValidDate(year, month, day)) continue;
        currentYear = year;
        currentMonth = month;
        results.push(toIsoDate(year, month, day));
        continue;
      }

      const mdMatch = token.match(/^(\d{1,2})[\/-](\d{1,2})$/);
      if (mdMatch) {
        const month = Number(mdMatch[1]);
        const day = Number(mdMatch[2]);
        if (!currentYear) currentYear = opts.defaultYear ?? null;
        if (!currentYear || !isValidDate(currentYear, month, day)) continue;
        if (currentMonth != null && month < currentMonth) {
          currentYear += 1;
        }
        currentMonth = month;
        results.push(toIsoDate(currentYear, month, day));
        continue;
      }

      const dayOnlyMatch = token.match(/^(\d{1,2})$/);
      if (dayOnlyMatch) {
        const day = Number(dayOnlyMatch[1]);
        if (currentYear == null || currentMonth == null) continue;
        if (!isValidDate(currentYear, currentMonth, day)) continue;
        results.push(toIsoDate(currentYear, currentMonth, day));
      }
    }

    const isoDates = normalizeIsoDates(results);
    const displayDates = isoDates.map(formatDisplayDate).filter(Boolean);
    return { isoDates, displayDates };
  };

  const dateUtils = {
    parsePerformanceDates,
    normalizeIsoDates,
    formatDisplayDate,
    toIsoDate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dateUtils;
  }

  if (typeof window !== 'undefined') {
    Object.assign(window, dateUtils);
  }
})();
