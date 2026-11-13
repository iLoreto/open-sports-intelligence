// MoneyPuck publishes season summaries as CSV; no HTML scraping or background polling.
export const moneyPuckUrl = (season: number) =>
  `https://moneypuck.com/moneypuck/playerData/seasonSummary/${season}/regular/teams.csv`;
export interface XgTeam {
  abbreviation: string; games: number; xgShare: number; xgf60: number; xga60: number;
  xgd60: number; highDangerFor: number; highDangerAgainst: number;
}
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Unterminated MoneyPuck CSV field');
  row.push(field); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function parseMoneyPuckTeams(text: string): Map<string, XgTeam> {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error('MoneyPuck CSV is empty');
  const header = rows.shift()!;
  const required = ['team','situation','games_played','iceTime','xGoalsFor','xGoalsAgainst','highDangerShotsFor','highDangerShotsAgainst'];
  const indexes = required.map(key => header.indexOf(key));
  if (indexes.some(i => i < 0)) throw new Error('MoneyPuck CSV schema changed');
  const col = (row: string[], key: string) => row[header.indexOf(key)];
  const num = (row: string[], key: string) => {
    const raw = col(row,key); if (raw === '' || raw === undefined || !Number.isFinite(Number(raw))) throw new Error('Invalid MoneyPuck ' + key);
    return Number(raw);
  };
  const teams = new Map<string, XgTeam>();
  for (const row of rows) {
    if (col(row,'situation') !== '5on5') continue;
    const abbreviation = col(row,'team')?.trim().toUpperCase();
    if (!abbreviation || !/^[A-Z]{2,4}$/.test(abbreviation)) throw new Error('Invalid MoneyPuck team');
    const games = num(row,'games_played'), seconds = num(row,'iceTime');
    const xgf = num(row,'xGoalsFor'), xga = num(row,'xGoalsAgainst');
    if (games <= 0 || seconds <= 0 || xgf < 0 || xga < 0 || xgf+xga === 0 || teams.has(abbreviation)) throw new Error('Invalid MoneyPuck team row');
    const factor = 3600 / seconds;
    teams.set(abbreviation, {
      abbreviation, games, xgShare: xgf/(xgf+xga),
      xgf60: xgf*factor, xga60: xga*factor, xgd60: (xgf-xga)*factor,
      highDangerFor: num(row,'highDangerShotsFor'),
      highDangerAgainst: num(row,'highDangerShotsAgainst')
    });
  }
  if (teams.size < 30 || teams.size > 34) throw new Error('Incomplete MoneyPuck NHL team coverage');
  return teams;
}
const TTL_MS = 600_000;
type CachedTeams = { teams: Map<string,XgTeam>; fetchedAt: string; expiresAt: number };
const seasonCache = new Map<number,CachedTeams>();
const inFlight = new Map<number,Promise<CachedTeams>>();
async function loadTeams(season:number):Promise<{entry:CachedTeams;stale:boolean}> {
 const cached=seasonCache.get(season);
 if(cached && Date.now()<cached.expiresAt)return {entry:cached,stale:false};
 let pending=inFlight.get(season);
 if(!pending){
  pending=(async()=>{
   const response=await fetch(moneyPuckUrl(season), {signal:AbortSignal.timeout(12000),headers:{Accept:'text/csv'}});
   if(!response.ok)throw new Error('MoneyPuck CSV HTTP '+response.status);
   const csv=await response.text();
   if(csv.length>5_000_000)throw new Error('MoneyPuck CSV too large');
   const teams=parseMoneyPuckTeams(csv);
   const fetchedAt=new Date().toISOString();
   const entry={teams,fetchedAt,expiresAt:Date.now()+TTL_MS};
   seasonCache.set(season,entry);
   return entry;
  })();
  inFlight.set(season,pending);
  void pending.finally(()=>{if(inFlight.get(season)===pending)inFlight.delete(season)}).catch(()=>{});
 }
 try{return {entry:await pending,stale:false}}
 catch(error){
  const previous=seasonCache.get(season);
  if(previous)return {entry:previous,stale:true};
  throw error;
 }
}
export async function moneyPuckComparison(left: string, right: string, season: number) {
  if (!/^[A-Z]{2,4}$/.test(left) || !/^[A-Z]{2,4}$/.test(right) || left === right)
    throw new Error('Select two different NHL teams');
  const {entry,stale}=await loadTeams(season);
  const teams=entry.teams;
  const aliases: Record<string,string> = { LA:'LAK', SJ:'SJS', TB:'TBL', UT:'UTA', UTAH:'UTA', VGK:'VGK', LV:'VGK', NJ:'NJD', NYI:'NYI', NYR:'NYR' };
  const a = teams.get(aliases[left] || left), b = teams.get(aliases[right] || right);
  if (!a || !b) throw new Error('Team missing from MoneyPuck season summary');
  return { source: 'MoneyPuck season summary (5-on-5)', fetchedAt: entry.fetchedAt, cacheExpiresAt: new Date(entry.expiresAt).toISOString(), cacheTtlSeconds:600, stale, season,
    situation: '5on5', left: a, right: b,
    note: 'Season-to-date expected goals, not game-win probabilities. Does not include current injuries, starting goalies, or market quotes.',
    attribution: 'Data: MoneyPuck.com' };
}
