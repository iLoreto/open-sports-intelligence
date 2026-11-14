const {test,expect}=require('@playwright/test');
const url='http://127.0.0.1:4179/live-monitor.html';
const competitor=(abbreviation,homeAway,score,stats={})=>({homeAway,team:{abbreviation,shortDisplayName:abbreviation},score:String(score),statistics:Object.entries(stats).map(([name,value])=>({name,displayValue:String(value)}))});
const event=(id,away,home,as,hs,league,scheduled=false)=>({id,status:{type:{state:scheduled?'pre':'in',description:scheduled?'Scheduled':'In Progress',shortDetail:scheduled?'Scheduled':league==='nba'?'Q4 7:42':'P2 12:30'},displayClock:scheduled?'0:00':'7:42'},competitions:[{competitors:[competitor(away,'away',as,{rebounds:34,shotsOnGoal:23}),competitor(home,'home',hs,{rebounds:40,shotsOnGoal:27})]}]});
const payload={fetchedAt:'2026-11-14T02:00:00Z',sources:[{league:'nba',events:[event('nba1','NY','IND',89,99,'nba')],error:null},{league:'nhl',events:[event('nhl1','NSH','VGK',0,0,'nhl',true),event('nhl2','VAN','NYR',2,2,'nhl')],error:null}]};
test.beforeEach(async({page})=>{
 await page.route('**/api/live-monitor/scores?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
 await page.route('**/api/live-monitor/trajectory?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plays:[
 {period:{number:1},clock:{displayValue:'11:40'},homeScore:2,awayScore:0},
 {period:{number:1},clock:{displayValue:'10:20'},homeScore:2,awayScore:3},
 {period:{number:2},clock:{displayValue:'08:15'},homeScore:28,awayScore:25}
 ]})}));
});
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
 await expect(knights).toContainText('Scheduled');
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
 async function attempt(password,confirmDelete){
  const handler=async dialog=>{
   if(dialog.type()==='prompt')await (password===null?dialog.dismiss():dialog.accept(password));
   else if(dialog.type()==='alert')await dialog.accept();
   else if(dialog.type()==='confirm')await (confirmDelete?dialog.accept():dialog.dismiss());
  };
  page.on('dialog',handler);try{await trash.click()}finally{page.off('dialog',handler)}
 }
 await attempt(null,false);await expect(page.locator('#stake')).toHaveText('$119.56');
 await attempt('xtby',true);await expect(page.locator('#stake')).toHaveText('$119.56');
 await attempt('XTBY',false);await expect(page.locator('#stake')).toHaveText('$119.56');
 await attempt('XTBY',true);await expect(page.locator('#stake')).toHaveText('$89.56');
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

test('NBA and NHL game windows render scoring trajectory and lead momentum without sell snapshot',async({page})=>{
 await page.goto(url);
 await expect(page.locator('article .trajectory svg')).toHaveCount(2);
 await expect(page.locator('article[aria-label*="Indiana Pacers"] .trajectory svg')).toHaveCount(2);
 await expect(page.locator('article[aria-label*="Vegas Golden Knights"] .trajectory svg')).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Sell snapshot');
 await expect(page.locator('#sell')).toHaveCount(0);
 await expect(page.locator('body')).toContainText('Lead momentum');
});
test('missing play-by-play reports unavailable instead of inventing charts',async({page})=>{
 await page.route('**/api/live-monitor/trajectory?**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"plays":[]}'}));
 await page.goto(url);
 await expect(page.locator('.trajectory svg')).toHaveCount(0);
 await expect(page.locator('.trajectory').first()).toContainText('no scored play-by-play checkpoints');
});

test('live monitor has back navigation',async({page})=>{await page.goto(url);await expect(page.getByRole('link',{name:/Back to Sports Radar/})).toHaveAttribute('href','/');});

test('NHL trajectory never erases a scored goal when later ESPN plays report 0-0',async({page})=>{
 await page.route('**/api/live-monitor/trajectory?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({teams:[],plays:[
 {period:{number:1},clock:{displayValue:'17:00'},homeScore:0,awayScore:0},
 {period:{number:1},clock:{displayValue:'15:00'},type:{text:'Goal'},scoringPlay:true,team:{id:'2',abbreviation:'NYR'},homeScore:1,awayScore:0},
 {period:{number:1},clock:{displayValue:'14:00'},homeScore:0,awayScore:0}
 ]})}));
 await page.goto(url);
 await expect(page.locator('article[aria-label*="New York Rangers"] .trajectory svg')).toHaveCount(3);
});

test('scheduled NHL games show zero statistics and no misleading trajectory',async({page})=>{
 await page.goto(url);
 const vegas=page.locator('article[aria-label*="Vegas Golden Knights"]');
 await expect(vegas.getByText('Game has not started · 0–0')).toBeVisible();
 await expect(vegas.locator('.stats')).not.toContainText('17 / 17');
 await expect(vegas.locator('.stats')).toContainText('0 / 0');
 await expect(vegas.locator('.trajectory svg')).toHaveCount(0);
});
