/** Read-only ESPN UEFA Nations League scoreboard adapter. Never invent missing fixtures or scores. */
export type NationsScore = {id:string;home:string;away:string;homeScore:number|null;awayScore:number|null;status:string;minute:number|null;date:string};
type Competitor={homeAway?:string;score?:string|number|{value?:number;displayValue?:string};team?:{displayName?:string;shortDisplayName?:string;name?:string}};
type Event={id?:string;date?:string;name?:string;competitions?:{competitors?:Competitor[];status?:{type?:{name?:string;state?:string;completed?:boolean};displayClock?:string}}[];status?:{type?:{name?:string;state?:string;completed?:boolean};displayClock?:string}};
function score(v:Competitor['score']):number|null {const n=typeof v==='object'&&v!==null?(v.value??v.displayValue):v;return n===undefined||n===null||n===''||!Number.isFinite(Number(n))?null:Number(n)}
export function normalizeNationsScoreboard(payload:unknown):NationsScore[]{
 if(!payload||typeof payload!=='object'||!('events' in payload)||!Array.isArray(payload.events))throw new Error('ESPN scoreboard missing events');
 const out:NationsScore[]=[];
 for(const event of payload.events as Event[]){
  const comp=event.competitions?.[0];const teams=comp?.competitors||[];
  const home=teams.find(t=>t.homeAway==='home');const away=teams.find(t=>t.homeAway==='away');
  if(!event.id||!home?.team||!away?.team)continue;
  const label=(t:Competitor)=>t.team?.displayName||t.team?.shortDisplayName||t.team?.name||'';
  if(!label(home)||!label(away))continue;
  const status=comp?.status||event.status;const type=status?.type;
  const clock=status?.displayClock||'';const match=clock.match(/^(\d+)(?::\d+)?/);
  out.push({id:event.id,home:label(home),away:label(away),homeScore:score(home.score),awayScore:score(away.score),status:type?.completed?'Final':type?.state==='in'?'Live':type?.state==='pre'?'Scheduled':type?.name||'Unknown',minute:type?.state==='in'&&match?Number(match[1]):null,date:event.date||''});
 }
 return out;
}
export async function getNationsScoreboard(now=new Date()):Promise<{source:string;fetchedAt:string;events:NationsScore[];note:string}>{
 const today=new Date(now.getTime()).toISOString().slice(0,10).replaceAll('-','');
 const endpoint='https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.nations/scoreboard?dates='+today+'&limit=100';
 const response=await fetch(endpoint,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error('ESPN Nations League HTTP '+response.status);
 const payload=await response.json();
 return {source:'ESPN public UEFA Nations League scoreboard',fetchedAt:new Date().toISOString(),events:normalizeNationsScoreboard(payload),note:'ESPN may not cover all fixtures. Missing matches remain unverified; scores and market prices are separate.'};
}
