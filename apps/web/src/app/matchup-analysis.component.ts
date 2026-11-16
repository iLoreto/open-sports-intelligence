import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, signal } from '@angular/core';

type Injury = { player: string; status: string | null; detail: string | null; updatedAt: string | null };
type FormGame = { date: string; opponent: string; scored: number; allowed: number; result: 'W' | 'L' | 'T' };
type AnalysisTeam = {
  name: string;
  poll: { name: string; rank: number | null } | null;
  standing: { rank: number | null; group: string | null; record: string | null } | null;
  recent: FormGame[];
  historyPartial: boolean;
  injuries: Injury[] | null;
};
type MatchupAnalysis = {
  fetchedAt: string;
  teams: AnalysisTeam[];
  headToHead: { date: string; scores: number[] }[];
  historyPartial: boolean;
};

@Component({
  selector: 'osi-matchup-analysis',
  standalone: true,
  imports: [CommonModule],
  template: `
    <dialog #dialog aria-labelledby="matchup-analysis-title" (close)="onClose()">
      <header>
        <div><p class="source">ESPN matchup analysis</p><h2 id="matchup-analysis-title">{{ title() }}</h2></div>
        <button type="button" (click)="dialog.close()">Close</button>
      </header>
      <p *ngIf="loading()" role="status">Loading ESPN matchup data…</p>
      <p *ngIf="error()" class="error" role="alert">{{ error() }}</p>
      <ng-container *ngIf="data() as analysis">
        <div class="teams">
          <section *ngFor="let team of analysis.teams" class="team">
            <h3>{{ team.name }}</h3>
            <p *ngIf="team.poll as poll">{{ poll.name }} · {{ poll.rank === null ? 'Unranked' : '#' + poll.rank }}</p>
            <p *ngIf="team.standing as standing">
              <span *ngIf="standing.rank !== null">#{{ standing.rank }} </span>{{ standing.group || 'Standings' }}
              <span *ngIf="standing.record"> · {{ standing.record }}</span>
            </p>
            <p *ngIf="!team.poll && !team.standing">Rankings and standings unavailable.</p>

            <h4>Last 5 games</h4>
            <ul>
              <li *ngFor="let game of team.recent">
                <time>{{ game.date | date:'MMM d, y' }}</time>
                <span>{{ game.opponent }}</span>
                <strong>{{ game.result }} {{ game.scored }}–{{ game.allowed }}</strong>
              </li>
            </ul>
            <p *ngIf="!team.recent.length">No completed games in the ESPN schedules retrieved.</p>
            <p *ngIf="team.historyPartial">Some ESPN schedules were unavailable.</p>

            <h4>Injuries</h4>
            <p *ngIf="team.injuries === null">ESPN injury data unavailable.</p>
            <p *ngIf="team.injuries?.length === 0">ESPN lists no injuries.</p>
            <ul>
              <li *ngFor="let injury of team.injuries">
                <strong>{{ injury.player }}</strong>
                <span>{{ injury.status || 'Status unavailable' }}<ng-container *ngIf="injury.detail"> · {{ injury.detail }}</ng-container></span>
                <time *ngIf="injury.updatedAt">{{ injury.updatedAt | date:'MMM d' }}</time>
              </li>
            </ul>
          </section>
        </div>

        <section class="meetings">
          <h3>Head-to-head</h3>
          <ul>
            <li *ngFor="let meeting of analysis.headToHead">
              <time>{{ meeting.date | date:'MMM d, y' }}</time>
              <span>{{ analysis.teams[0].name }} {{ meeting.scores[0] }}–{{ meeting.scores[1] }} {{ analysis.teams[1].name }}</span>
            </li>
          </ul>
          <p *ngIf="!analysis.headToHead.length">No completed meetings in the ESPN schedules retrieved.</p>
          <p *ngIf="analysis.historyPartial">Head-to-head coverage may be incomplete.</p>
        </section>
        <p class="source">Retrieved from ESPN · {{ analysis.fetchedAt | date:'medium' }}</p>
      </ng-container>
    </dialog>
  `,
  styles: [`
    dialog{box-sizing:border-box;width:min(900px,calc(100% - 24px));max-height:90vh;overflow:auto;padding:20px 24px;
      background:#111d2d;color:#e7edf7;border:1px solid #354359;border-radius:16px;font:15px/1.45 system-ui,sans-serif}
    dialog::backdrop{background:#050b14c9}
    header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}
    header button{font:inherit;border:1px solid #354359;border-radius:8px;padding:7px 12px;background:#18263a;color:inherit;cursor:pointer}
    h2,h3,h4,p{margin:0}h2{font-size:clamp(19px,3vw,27px)}h3{font-size:17px}h4{margin-top:14px}
    p{color:#b7c6d8;margin:5px 0}.source{font-size:12px}.error{color:#ffaaa6}
    .teams{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .team,.meetings{padding:14px;border:1px solid #29394e;background:#172538;border-radius:10px}
    .meetings{margin-top:12px}
    ul{margin:5px 0 0;padding:0;list-style:none}
    li{display:flex;align-items:baseline;gap:6px 10px;flex-wrap:wrap;padding:7px 0;border-top:1px solid #29394e}
    time{font-size:12px;color:#a9b7cc}li strong{white-space:nowrap}li span{flex:1 1 auto}
    @media(max-width:620px){dialog{padding:14px}.teams{grid-template-columns:1fr}}
  `]
})
export class MatchupAnalysisComponent {
  @ViewChild('dialog', { static: true }) private dialog!: ElementRef<HTMLDialogElement>;
  readonly title = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly data = signal<MatchupAnalysis | null>(null);
  private request?: AbortController;

  async open(league: string | null, eventId: string, title: string): Promise<void> {
    if (!league) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.title.set(title);
    this.loading.set(true);
    this.error.set('');
    this.data.set(null);
    if (!this.dialog.nativeElement.open) this.dialog.nativeElement.showModal();
    try {
      const query = new URLSearchParams({ league, game: eventId });
      const response = await fetch('/api/games/analyze?' + query, { signal: request.signal });
      const payload = await response.json() as MatchupAnalysis & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'ESPN matchup data unavailable.');
      if (this.request === request) this.data.set(payload);
    } catch (error) {
      if (this.request === request) this.error.set(error instanceof Error ? error.message : 'ESPN matchup data unavailable.');
    } finally {
      if (this.request === request) this.loading.set(false);
    }
  }

  onClose(): void {
    if (this.dialog.nativeElement.open) return;
    this.request?.abort();
    this.request = undefined;
  }
}
