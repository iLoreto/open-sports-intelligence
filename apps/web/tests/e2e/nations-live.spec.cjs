const {test,expect}=require('@playwright/test');
const url='http://127.0.0.1:4179/nations-live.html';
const summary={header:{competitions:[{competitors:[{team:{abbreviation:'NY'},score:'69'},{team:{abbreviation:'IND'},score:'80'}],status:{type:{detail:'Q3 4:24'}}}]},plays:[
 {period:{number:1},clock:{displayValue:'11:40'},homeScore:'2',awayScore:'0',scoringPlay:true},
 {period:{number:1},clock:{displayValue:'11:20'},homeScore:'2',awayScore:'3',scoringPlay:true},
 {period:{number:3},clock:{displayValue:'4:24'},homeScore:'80',awayScore:'69',scoringPlay:true}
]};
test.beforeEach(async({page})=>{await page.route('**/api/nba/momentum',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(summary)}))});
test('legacy monitor opens NBA monitor and removes soccer ticket display',async({page})=>{
 await page.goto(url);await expect(page).toHaveURL(/live-monitor.html/);
 await expect(page.getByRole('heading',{name:/Knicks vs Pacers/})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Tickets'})).toBeVisible();
 await expect(page.locator('body')).not.toContainText('Scotland');
 await expect(page.locator('body')).not.toContainText('3-leg parlay');
});
test('plots complete scoring progression and margin from ESPN plays',async({page})=>{
 await page.goto(url);
 await expect(page.getByRole('status')).toContainText('3 scoring checkpoints');
 await expect(page.locator('#ny')).toHaveText('Knicks 69');
 await expect(page.locator('#ind')).toHaveText('Pacers 80');
 await expect(page.locator('#totals polyline')).toHaveCount(2);
 await expect(page.locator('#margin polyline')).toHaveCount(1);
});
test('manual refresh updates the live chart without dropping history',async({page})=>{
 await page.goto(url);await expect(page.getByRole('status')).toContainText('3 scoring checkpoints');
 await page.getByRole('button',{name:'Refresh now'}).click();
 await expect(page.locator('#margin polyline')).toHaveCount(1);
});
test('API failure is clearly identified without fabricated momentum',async({page})=>{
 await page.route('**/api/nba/momentum',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.goto(url);await expect(page.getByRole('status')).toContainText('Data unavailable');
 await expect(page.locator('#margin polyline')).toHaveCount(0);
});

test('shows all screenshot tickets and reconciles totals',async({page})=>{
 await page.goto(url);
 const overview=page.getByRole('region',{name:'Ticket overview'});
 await expect(overview).toContainText('$119.56');
 await expect(overview).toContainText('$205.84');
 await expect(overview).toContainText('$86.28');
 await expect(page.locator('#ticket-list')).toContainText('Indiana Pacers');
 await expect(page.locator('#ticket-list')).toContainText('Vegas Golden Knights');
 await expect(page.locator('#ticket-list')).toContainText('New York Rangers');
});
test('removing a ticket changes monitor totals persistently',async({page})=>{
 await page.goto(url);
 await page.getByRole('button',{name:/Remove New York Rangers/}).click();
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$89.56');
 await page.reload();
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$89.56');
});

test('monitor script does not leak source text into the rendered page',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 await expect(page.locator('#ticket-list article')).toHaveCount(3);
 await expect(page.locator('body')).not.toContainText('function renderTickets()');
 await expect(page.locator('body')).not.toContainText('toFixed(2)');
 await expect(page.getByRole('region',{name:'Ticket overview'})).toContainText('$119.56');
 await expect(page.locator('#totals polyline')).toHaveCount(2);
 expect(errors).toEqual([]);
});

test('shows explicit upstream error rather than indefinite waiting',async({page})=>{
 await page.route('**/api/nba/momentum',r=>r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'ESPN request failed'})}));
 await page.goto(url);
 await expect(page.getByRole('status')).toContainText('ESPN request failed');
});
