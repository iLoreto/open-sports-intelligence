import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNationsScoreboard} from './nations-scoreboard.ts';

test('maps ESPN competitors and scores without reversing home and away',()=>{
 const events=normalizeNationsScoreboard({events:[{id:'123',date:'2026-11-13T19:45:00Z',competitions:[{competitors:[{homeAway:'away',team:{displayName:'Slovenia'},score:'0'},{homeAway:'home',team:{displayName:'Switzerland'},score:'2'}],status:{type:{state:'in',completed:false},displayClock:"54:12"}}]}]});
 assert.equal(events.length,1);
 assert.deepEqual([events[0].home,events[0].away,events[0].homeScore,events[0].awayScore,events[0].minute,events[0].status],['Switzerland','Slovenia',2,0,54,'Live']);
});
test('missing scores remain null, not zero',()=>{
 const [event]=normalizeNationsScoreboard({events:[{id:'124',competitions:[{competitors:[{homeAway:'home',team:{displayName:'Germany'}},{homeAway:'away',team:{displayName:'Serbia'}}],status:{type:{state:'pre'}}}]}]});
 assert.equal(event.homeScore,null);assert.equal(event.awayScore,null);assert.equal(event.status,'Scheduled');
});
test('missing events is an explicit provider schema error',()=>assert.throws(()=>normalizeNationsScoreboard({}),/missing events/));
test('malformed events are skipped',()=>assert.deepEqual(normalizeNationsScoreboard({events:[{id:'x',competitions:[]}]}),[]));
