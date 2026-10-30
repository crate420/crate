(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CratePlaylistPeriods = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function years(row) {
    return (row?.year_counts || []).filter(r => Number.isInteger(Number(r.year)) && Number(r.year) >= 1900 && Number(r.year) <= new Date().getFullYear() && Number(r.count) > 0);
  }
  function options(row) {
    const decades = [...new Set(years(row).map(r => Math.floor(Number(r.year) / 10) * 10))].sort((a,b) => a-b);
    return [{value:'all', label:'All'}, ...decades.map(d => ({value:d+'s', label:d+'s'}))];
  }
  function range(value) {
    if (!/^\d{3}0s$/.test(String(value))) return {};
    const min = Number(value.slice(0,4));
    return {year_min:min, year_max:Math.min(min+9,new Date().getFullYear())};
  }
  function count(row, value) {
    if (value === 'all') return Number(row?.count || 0);
    const r = range(value);
    if (!r.year_min) return Number(row?.count || 0);
    return years(row).reduce((n,y) => n+(Number(y.year)>=r.year_min && Number(y.year)<=r.year_max ? Number(y.count) : 0),0);
  }
  return Object.freeze({options,range,count});
});
