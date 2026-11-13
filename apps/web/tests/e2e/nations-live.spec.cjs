const { test, expect } = require('@playwright/test');
const pageUrl = 'http://127.0.0.1:4179/nations-live.html';
const sample = (overrides = {}) => ({
 home:'Gibraltar',away:'Andorra',homeScore:0,awayScore:2,status:'Live',minute:45,date:'2026-11-13T20:00:00Z',
 stats:{home:{possession:'40%',shots:'4',shotsOnTarget:'1',xg:null},away:{possession:'60%',shots:'9',shotsOnTarget:'5',xg:null}},
 ...overrides
});
test.beforeEach(async ({page}) => {
 await page.route('**/api/nations/scoreboard', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({fetchedAt:'2026-11-13T20:48:00Z',events:[sample()]})}));
});
test('renders six singles plus parlay without double-counting parlay',async ({page})=>{
 await page.goto(pageUrl);
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('Stake');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$268.53');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$436.36');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$167.83');
 await expect(page.getByRole('region',{name:'Ticket overview'})).not.toContainText('$338.82');
});
test('shows live fixture, statistics, insight and one shared parlay',async ({page})=>{
 await page.goto(pageUrl);
 const fixtures=page.getByRole('region',{name:'ESPN Nations League fixtures'});
 await expect(fixtures.locator('.match')).toHaveCount(2);
 await expect(fixtures).toContainText('Gibraltar');
 await expect(fixtures).toContainText('Andorra');
 await expect(fixtures).toContainText('Possession');
 await expect(fixtures).toContainText('GAME READ');
 await expect(fixtures).toContainText('Possession: Gibraltar 40% / Andorra 60%');
 await expect(fixtures).toContainText('MATCH STATISTICS');
 await expect(fixtures.locator('.statline').filter({hasText:'Possession'})).toHaveCount(1);
 await expect(fixtures.locator('.statline').filter({hasText:'Shots on target'})).toHaveCount(1);
 await expect(fixtures).toContainText('Stake $24.60');
});
test('filter leaves financial summary visible',async ({page})=>{
 await page.goto(pageUrl);
 await page.getByRole('combobox',{name:'Filter matches'}).selectOption('final');
 await expect(page.locator('.match')).toHaveCount(1);
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$268.53');
});
test('handles API failure without losing ticket totals',async ({page})=>{
 await page.route('**/api/nations/scoreboard',route=>route.fulfill({status:503,body:'unavailable'}));
 await page.goto(pageUrl);
 await expect(page.getByRole('status')).toContainText('ESPN unavailable');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$436.36');
});
test('script contains no syntax or runtime errors',async ({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pageUrl);
 await expect(page.getByRole('status')).toContainText('ESPN checked');
 expect(errors).toEqual([]);
});

test('settles a final single loss and updates aggregate payout and profit',async ({page})=>{
 await page.route('**/api/nations/scoreboard',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({fetchedAt:'2026-11-13T20:48:00Z',events:[sample({status:'Final',homeScore:2,awayScore:0})]})}));
 await page.goto(pageUrl);
 const overview=page.getByRole('region',{name:'Ticket overview'});
 await expect(overview).toContainText('$396.32');
 await expect(overview).toContainText('$127.79');
 await expect(page.locator('.match')).toContainText('LOSS');
});
test('settles winning singles and parlay only when all three legs are final wins',async ({page})=>{
 const fixtures=[
 sample({home:'North Macedonia',away:'Scotland',homeScore:0,awayScore:1,status:'Final'}),
 sample({home:'Germany',away:'Serbia',homeScore:2,awayScore:0,status:'Final'}),
 sample({home:'Faroe Islands',away:'Slovakia',homeScore:0,awayScore:3,status:'Final'})
 ];
 await page.route('**/api/nations/scoreboard',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({fetchedAt:'2026-11-13T20:48:00Z',events:fixtures})}));
 await page.goto(pageUrl);
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$436.36');
});

test('trash removes single ticket and recalculates totals persistently',async ({page})=>{
 await page.goto(pageUrl);
 await page.getByRole('button',{name:'Remove Gibraltar vs Andorra single ticket'}).click();
 const overview=page.getByRole('region',{name:'Ticket overview'});
 await expect(overview).toContainText('$243.93');
 await expect(overview).toContainText('$396.32');
 await expect(page.locator('.match')).toHaveCount(0);
 await page.reload();
 await expect(overview).toContainText('$243.93');
});
test('trash removes parlay independently from single tickets',async ({page})=>{
 await page.goto(pageUrl);
 await page.getByRole('button',{name:'Remove 3-leg parlay ticket'}).click();
 const overview=page.getByRole('region',{name:'Ticket overview'});
 await expect(overview).toContainText('$193.53');
 await expect(overview).toContainText('$281.35');
 await expect(page.locator('.match')).toHaveCount(1);
});
test('Scotland remains a parlay fixture without its cashed-out single',async ({page})=>{
 await page.route('**/api/nations/scoreboard',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({fetchedAt:'2026-11-13T20:48:00Z',events:[sample({home:'North Macedonia',away:'Scotland'})]})}));
 await page.goto(pageUrl);
 await expect(page.getByRole('article',{name:'3-leg parlay ticket'})).toContainText('Scotland');
 await expect(page.getByRole('article',{name:'3-leg parlay ticket'})).not.toContainText('Single ticket');
});

test('parlay is a standalone removable ticket and Scotland has no cashed-out single',async ({page})=>{
 await page.goto(pageUrl);
 const parlay=page.getByRole('article',{name:'3-leg parlay ticket'});
 await expect(parlay).toBeVisible();
 await expect(parlay).toContainText('Scotland / Germany / Slovakia');
 await expect(parlay.getByRole('button',{name:'Remove 3-leg parlay ticket'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Ticket overview'}).getByRole('button')).toHaveCount(0);
 await parlay.getByRole('button',{name:'Remove 3-leg parlay ticket'}).click();
 await expect(parlay).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$193.53');
});
