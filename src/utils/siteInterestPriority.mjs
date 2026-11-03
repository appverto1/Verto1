// Only website signups in Prospecção receive priority. Other card ordering is untouched.
export function compareSiteInterestProspecting(a,b) {
  const first=a?.siteInterestAt ? Date.parse(a.siteInterestAt) : NaN;
  const second=b?.siteInterestAt ? Date.parse(b.siteInterestAt) : NaN;
  const isFirst=Number.isFinite(first);
  const isSecond=Number.isFinite(second);
  if(isFirst!==isSecond) return isFirst ? -1 : 1;
  if(isFirst && isSecond) return second-first || String(a.id||'').localeCompare(String(b.id||''));
  return 0;
}
