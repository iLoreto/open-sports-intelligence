const {test,expect}=require('@playwright/test');
const url='http://127.0.0.1:4179/live-monitor.html';
const competitor=(abbreviation,homeAway,score,stats={})=>({homeAway,team:{abbreviation,shortDisplayName:abbreviation},score:String(score),statistics:Object.entries(stats).map(([name,value])=>({name,displayValue:String(value)}))});
const event=(id,away,home,as,hs,league)=>({id,status:{type:{state:'in',description:'In Progress',shortDetail:league==='nba'?'Q4 7:42':'P2 12:30'},displayClock:'7:42'},competitions:[{competitors:[competitor(away,'away',as,{rebounds:34,shotsOnGoal:23}),competitor(home,'home',hs,{rebounds:40,shotsOnGoal:27})]}]});
const payload={fetchedAt:'2026-11-14T02:00:00Z',sources:[{league:'nba',events:[event('nba1','NY','IND',89,99,'nba')],error:null},{league:'nhl',events:[event('nhl1','NSH','VGK',1,3,'nhl'),event('nhl2','VAN','NYR',2,2,'nhl')],error:null}]};
test.beforeEach(async({page})=>{await page.route('**/api/live-monitor/scores?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))});
test('canonical page and legacy redirect show three ticket game windows',async({page})=>{
 await page.goto('http://127.0.0.1:4179/nations-live.html');
 await expect(page).toHaveURL(/live-monitor.html/);
 await expect(page.getByRole('heading',{name:'Live Ticket Monitor'})).toBeVisible();
 await expect(page.locator('#matches article')).toHaveCount(3);
 await expect(page.locator('body')).not.toContainText('Scotland');
});
test('NBA and NHL tickets show ESPN scores, game status and stats',async({page})=>{
 await page.goto(url);
 await expect(page.getByRole('status')).toContainText('ESPN');
 const pacers=page.locator('article[aria-label*="Indiana Pacers"]');
 await expect(pacers).toContainText('99');
 await expect(pacers).toContainText('89');
 await expect(pacers).toContainText('NY');
 await expect(pacers).not.toContainText('Unverified');
 await expect(pacers).toContainText('Rebounds');
 const knights=page.locator('article[aria-label*="Vegas Golden Knights"]');
 await expect(knights).toContainText('3');
 await expect(knights).toContainText('Shots');
});
test('league filter switches category without navigation or losing tickets',async({page})=>{
 await page.goto(url);await expect(page.locator('#matches article')).toHaveCount(3);
 await page.locator('#league').selectOption('nba');
 await expect(page.locator('#matches article')).toHaveCount(1);
 await expect(page).toHaveURL(/live-monitor.html/);
 await page.locator('#league').selectOption('nhl');
 await expect(page.locator('#matches article')).toHaveCount(2);
 await page.locator('#league').selectOption('all');
 await expect(page.locator('#matches article')).toHaveCount(3);
});
test('trash icon requires exact password and confirmation before removal',async({page})=>{
 await page.goto(url);await expect(page.locator('#stake')).toHaveText('$119.56');
 const trash=page.getByRole('button',{name:/Delete New York Rangers/});
 page.once('dialog',dialog=>dialog.dismiss());await trash.click();
 await expect(page.locator('#stake')).toHaveText('$119.56');
 page.once('dialog',dialog=>dialog.accept('xtby'));await trash.click();
 page.once('dialog',dialog=>dialog.accept());await expect(page.locator('#stake')).toHaveText('$119.56');
 page.once('dialog',dialog=>dialog.accept('XTBY'));await trash.click();
 page.once('dialog',dialog=>dialog.dismiss());await expect(page.locator('#stake')).toHaveText('$119.56');
 page.once('dialog',dialog=>dialog.accept('XTBY'));await trash.click();
 page.once('dialog',dialog=>dialog.accept());await expect(page.locator('#stake')).toHaveText('$89.56');
 await page.reload();await expect(page.locator('#matches article')).toHaveCount(2);
 await expect(page.locator('#stake')).toHaveText('$89.56');
});
test('ESPN errors are explicit without fake scores',async({page})=>{
 await page.route('**/api/live-monitor/scores?**',route=>route.fulfill({status:502,contentType:'application/json',body:'{"error":"ESPN upstream failed"}'}));
 await page.goto(url);
 await expect(page.getByRole('status')).toContainText('ESPN unavailable');
 await expect(page.locator('#matches article')).toHaveCount(3);
 await expect(page.locator('article[aria-label*="Indiana Pacers"]')).toContainText('Unverified');
});
test('inline script runs without browser exceptions',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await expect(page.locator('#matches article')).toHaveCount(3);
 expect(errors).toEqual([]);
});
