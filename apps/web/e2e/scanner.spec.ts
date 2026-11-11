import { test, expect, type Page } from '@playwright/test';

const leagueButtons = [
  { id: 'nba', label: 'NBA' },
  { id: 'nfl', label: 'NFL' },
  { id: 'nhl', label: 'NHL' },
  { id: 'mlb', label: 'MLB' },
  { id: 'wnba', label: 'WNBA' },
  { id: 'ncaaf', label: 'NCAA Football' },
  { id: 'ncaam', label: 'NCAA Basketball' }
] as const;

async function mockApi(page: Page, scanRequests: string[]): Promise<void> {
  await page.route('**/api/nba/teams', async route => {
	await route.fulfill({
	  status: 200,
	  contentType: 'application/json',
	  body: JSON.stringify({
		teams: [
		  { id: 1, full_name: 'Boston Celtics', abbreviation: 'BOS' },
		  { id: 2, full_name: 'Philadelphia 76ers', abbreviation: 'PHI' }
		]
	  })
	});
  });

  await page.route(/.*\/api\/leagues\/(nfl|nhl|mlb|wnba|ncaaf|ncaam)\/teams$/, async route => {
	await route.fulfill({
	  status: 200,
	  contentType: 'application/json',
	  body: JSON.stringify({
		teams: [
		  { id: '1', full_name: 'Alpha Team', abbreviation: 'ALP' },
		  { id: '2', full_name: 'Beta Team', abbreviation: 'BET' }
		]
	  })
	});
  });

  await page.route(/.*\/api\/(nba\/compare|leagues\/(nfl|nhl|mlb|wnba|ncaaf|ncaam)\/compare)\?.*/, async route => {
	const url = new URL(route.request().url());
	const sample = Number(url.searchParams.get('sample') || '10');
	await route.fulfill({
	  status: 200,
	  contentType: 'application/json',
	  body: JSON.stringify({
		source: 'Mock Compare API',
		fetchedAt: '2026-11-11T20:45:00.000Z',
		sample,
		left: {
		  games: 1,
		  wins: 1,
		  losses: 0,
		  pointsFor: 101,
		  pointsAgainst: 95,
		  recent: [{ date: '2026-11-10', scored: 101, allowed: 95, win: true }]
		},
		right: {
		  games: 1,
		  wins: 0,
		  losses: 1,
		  pointsFor: 95,
		  pointsAgainst: 101,
		  recent: [{ date: '2026-11-10', scored: 95, allowed: 101, win: false }]
		},
		partial: false,
		note: 'Mocked comparison result'
	  })
	});
  });

  await page.route('**/api/markets/scan**', async route => {
	const url = new URL(route.request().url());
	const league = (url.searchParams.get('league') || 'nba').toLowerCase();
	scanRequests.push(league);
	await route.fulfill({
	  status: 200,
	  contentType: 'application/json',
	  body: JSON.stringify({
		source: 'Kalshi public API',
		scannedAt: '2026-11-11T20:45:00.000Z',
		markets: [
		  {
			ticker: `${league.toUpperCase()}-GAME-ML`,
			event: `${league.toUpperCase()} Alpha at Beta`,
			title: 'Will Alpha beat Beta?',
			side: 'YES',
			askCents: 61,
			yesBid: '0.60',
			yesAsk: '0.61',
			noAsk: '0.39',
			last: '0.60',
			volume24h: '42.0'
		  }
		],
		partialCoverage: false,
		note: 'Sports-only test snapshot',
		pagesScanned: 3,
		sportsEvents: 12
	  })
	});
  });
}

test('scanner runs across all non-tennis leagues and sends correct league parameter', async ({ page }) => {
  const scanRequests: string[] = [];
  await mockApi(page, scanRequests);
  await page.goto('/');

  await page.getByRole('button', { name: 'Market Scanner' }).click();

  const sportsNav = page.getByRole('navigation', { name: 'Sports' });
  for (const league of leagueButtons) {
	await sportsNav.getByRole('button', { name: new RegExp(league.label, 'i') }).click();
	await page.getByRole('button', { name: 'Scan now →' }).click();

	await expect(page.getByText(`${league.id.toUpperCase()} Alpha at Beta`)).toBeVisible();
	await expect(page.getByText(`${league.id.toUpperCase()}-GAME-ML`)).toBeVisible();
	await expect(page.getByText(/retire|retirement|before 2030/i)).toHaveCount(0);
  }

  await expect.poll(() => scanRequests.length).toBe(leagueButtons.length);
  expect(scanRequests).toEqual(leagueButtons.map(league => league.id));
});

test('research comparison works across all non-tennis leagues in the UI', async ({ page }) => {
  const scanRequests: string[] = [];
  await mockApi(page, scanRequests);
  await page.goto('/');

  const sportsNav = page.getByRole('navigation', { name: 'Sports' });
  const teamA = page.locator('label:has-text("Team A") select');
  const teamB = page.locator('label:has-text("Team B") select');

  for (const league of leagueButtons) {
	await sportsNav.getByRole('button', { name: new RegExp(league.label, 'i') }).click();
	await expect(teamA.locator('option')).toHaveCount(3);

	await teamA.selectOption('1');
	await teamB.selectOption('2');
	await page.getByRole('button', { name: 'Run comparison →' }).click();

	await expect(page.getByText('Mock Compare API')).toBeVisible();
	await expect(page.getByText('1W–0L (1 games)')).first().toBeVisible();
	await expect(page.getByText('Mocked comparison result')).toBeVisible();
  }
});
