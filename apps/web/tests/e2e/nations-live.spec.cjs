const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pageUrl = pathToFileURL(path.resolve(__dirname, '../public/nations-live.html')).href;
const sample = (overrides = {}) => ({
 home:'Gibraltar',away:'Andorra',homeScore:0,awayScore:2,status:'Live',minute:45,date:'2026-11-13T20:00:00Z',
 stats:{home:{possession:'40%',shots:'4',shotsOnTarget:'1',xg:null},away:{possession:'60%',shots:'9',shotsOnTarget:'5',xg:null}},
 ...overrides
});
test.beforeEach(async ({page}) => {
 await page.route('**/api/nations/scoreboard', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({fetchedAt:'2026-11-13T20:48:00Z',events:[sample()]})}));
});
test('renders nine confirmed tickets without double-counting parlay',async ({page})=>{
 await page.goto(pageUrl);
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('8 singles + 1 parlay');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$343.52');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$563.25');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$219.73');
 await expect(page.getByRole('region',{name:'Ticket overview'})).not.toContainText('$338.82');
});
test('shows live fixture, statistics, insight and one shared parlay',async ({page})=>{
 await page.goto(pageUrl);
 const fixtures=page.getByRole('region',{name:'ESPN Nations League fixtures'});
 await expect(fixtures.locator('.match')).toHaveCount(1);
 await expect(fixtures).toContainText('Gibraltar');
 await expect(fixtures).toContainText('Andorra');
 await expect(fixtures).toContainText('Possession');
 await expect(fixtures).toContainText('MATCH READ');
 await expect(fixtures).toContainText('Stake $24.60');
});
test('filter leaves financial summary visible',async ({page})=>{
 await page.goto(pageUrl);
 await page.getByRole('combobox',{name:'Filter matches'}).selectOption('final');
 await expect(page.locator('.match')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$343.52');
});
test('handles API failure without losing ticket totals',async ({page})=>{
 await page.route('**/api/nations/scoreboard',route=>route.fulfill({status:503,body:'unavailable'}));
 await page.goto(pageUrl);
 await expect(page.getByRole('status')).toContainText('ESPN unavailable');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$563.25');
});
test('script contains no syntax or runtime errors',async ({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pageUrl);
 await expect(page.getByRole('status')).toContainText('ESPN checked');
 expect(errors).toEqual([]);
});
