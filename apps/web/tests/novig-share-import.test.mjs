import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const html = readFileSync(new URL('../public/live-monitor.html', import.meta.url), 'utf8');
const parser = html.slice(html.indexOf('function parseNovig(text){'), html.indexOf('function parseKalshi(text){'));
const parse = runInNewContext(parser + '\nparseNovig', {});
test('Novig soccer share: Ireland versus Austria', () => {
 const text = 'NOVIG\nAustria Yes • 62.0%\nRegular Time 3-Way Winner\nMATCHED\nAmount $25.00\nTo Pay $40.32\nIRL 11:45 AM Today AUT\nPlaced: 10:51AM';
 const result = parse(text);
 assert.equal(result.platform, 'novig');
 assert.equal(result.league, 'soccer');
 assert.equal(result.away, 'IRL');
 assert.equal(result.home, 'AUT');
 assert.equal(result.pick, 'AUT');
 assert.equal(result.entry, '62.0');
 assert.equal(result.stake, 25);
 assert.equal(result.payout, 40.32);
 assert.equal(Number((result.payout - result.stake).toFixed(2)), 15.32);
});
test('reject incomplete soccer matchup', () => {
 assert.throws(() => parse('NOVIG MATCHED Austria Yes 62.0% Regular Time 3-Way Winner Amount $25.00 To Pay $40.32'), /matchup/);
});
test('reject zero stake', () => {
 assert.throws(() => parse('NOVIG MATCHED Amount $0.00 To Pay $40.32'), /Invalid ticket amounts/);
});

// Regression fixture: literal output from Tesseract on the official Novig shared image.
test('Novig soccer share accepts actual image OCR layout', () => {
 const text = '4\nNJ NOVIG\nAustria Yes ° 62.0%\nRegular Time 3-Way Winner\nAmount To Pay\n$25.00 $40.32\nIRL 11:45 AM AUT\nfi Today =';
 const result = parse(text);
 assert.deepEqual([result.league,result.away,result.home,result.pick,result.stake,result.payout,result.entry],['soccer','IRL','AUT','AUT',25,40.32,'62.0']);
});
test('reject incomplete image without financial values', () => {
 assert.throws(() => parse('NOVIG Austria Yes 62.0% Regular Time 3-Way Winner Amount To Pay IRL AUT'), /Stake or payout/);
});
