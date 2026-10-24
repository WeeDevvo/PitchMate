/**
 * WCAG 2.1 A and AA audits of every shared component, in both themes, with an
 * open dialog audited on its own. Colour contrast is checked separately against
 * the token table (`src/design/tokens.contrast.test.ts`), since jsdom computes
 * no styles.
 */
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it } from 'vitest';

import { THEME_ATTRIBUTE, applyThemeAttribute, type Theme } from '../theme';
import {
  Avatar,
  AvatarStack,
  Badge,
  Banner,
  BibFlag,
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  ErrorState,
  FormerBadge,
  FormGuide,
  GuestBadge,
  Icon,
  IconButton,
  Logo,
  DayPicker,
  FairnessMeter,
  MatchCard,
  MatchProgress,
  MatchStateChip,
  NavItem,
  Scoreboard,
  TeamColumn,
  NotFoundState,
  NotificationItem,
  NotificationList,
  PlayerRow,
  SquadCard,
  Sidebar,
  SidebarLabel,
  TopBar,
  ProvisionalBadge,
  Rating,
  ResultBadge,
  RoleBadge,
  SegmentedControl,
  Select,
  Skeleton,
  Tabs,
  TextField,
  Toast,
  Toggle,
} from '.';

const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const THEMES: readonly Theme[] = ['dark', 'light'];

async function expectNoWcagViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container, { runOnly: { type: 'tag', values: WCAG_A_AND_AA_TAGS } });
  expect(results.passes.length + results.incomplete.length + results.violations.length).toBeGreaterThan(0);
  expect(results).toHaveNoViolations();
}

const noop = () => {};

function Gallery() {
  return (
    <>
    <TopBar>
      <Logo href="/" />
      <IconButton icon="bell" label="Notifications, 3 unread" badge={<Badge tone="count">3</Badge>} />
    </TopBar>
    <Sidebar label="Squad">
      <NavItem label="Players" icon="users" active render={(props) => <a href="/players" {...props} />} />
      <SidebarLabel>Your squads</SidebarLabel>
      <NavItem label="Thursday Ballers" render={(props) => <a href="/squad" {...props} />} />
    </Sidebar>
    <main>
      <h1>Components</h1>
      <Logo />
      <Logo href="/" variant="green" />
      <Icon name="ball" label="Football" />
      <Button>Roll teams</Button>
      <Button variant="secondary" icon="shuffle">
        Re-roll
      </Button>
      <Button variant="destructive">Cancel match</Button>
      <Button variant="ghost" loading>
        Saving
      </Button>
      <Button disabled>Lock teams</Button>
      <IconButton icon="more" label="More actions" badge={<Badge tone="count">3</Badge>} />
      <TextField label="Email" hint="We'll send a link" />
      <TextField label="Join code" code error="That code has expired, ask for a fresh one" />
      <Select label="Skill tier" options={['Beginner', 'Average', 'Strong']} />
      <Toggle label="Live tracking" description="Goals and keepers during the match" defaultChecked />
      <Chip selected>All</Chip>
      <Chip icon="dice">Silly name</Chip>
      <RoleBadge role="owner" />
      <RoleBadge role="admin" />
      <GuestBadge />
      <ProvisionalBadge />
      <FormerBadge />
      <Badge tone="live">Live</Badge>
      <MatchStateChip state="gathering" />
      <MatchStateChip state="cancelled" />
      <MatchProgress state="rolled" />
      <ResultBadge result="W" size="lg" />
      <FormGuide results={['W', 'L', 'D', 'W']} />
      <Rating value="1,240" delta={12} />
      <Rating provisional band="1,1xx" />
      <BibFlag size="lg" />
      <BibFlag off />
      <Avatar name="Priya Shah" />
      <Avatar name="Big Dave" guest tag={<Icon name="glove" size={12} />} />
      <AvatarStack names={['A B', 'C D', 'E F', 'G H', 'I J']} />
      <Tabs
        label="Squad sections"
        active="players"
        onChange={noop}
        tabs={[
          { id: 'players', label: 'Players', count: 14 },
          { id: 'matches', label: 'Matches', icon: 'calendar' },
          { id: 'admin', label: 'Admin', disabled: true },
        ]}
      />
      <SegmentedControl
        label="Rank by"
        value="rating"
        onChange={noop}
        options={[
          { value: 'appearances', label: 'Appearances' },
          { value: 'rating', label: 'Rating' },
        ]}
      />
      <Toast actionLabel="Undo">Goal recorded</Toast>
      <Toast tone="offline">Saved on your phone</Toast>
      <Banner title="Live tracking is off">Rich stats appear once it's on.</Banner>
      <Card as="section" aria-label="Next match">
        <Skeleton width="40%" />
        <Skeleton width={40} height={40} circle />
      </Card>
      <EmptyState title="No matches yet" action={<Button>Draft a match</Button>}>
        Sort Sunday out.
      </EmptyState>
      <ErrorState onRetry={noop} />
      <NotFoundState />
      <MatchCard
        title={<a href="/m">Goals Glasgow, Pitch 4</a>}
        date={{ dow: 'Wed', num: '28', mon: 'Oct' }}
        state="gathering"
        meta={<span>11 players</span>}
      />
      <fieldset>
        <legend>Days you can make</legend>
        <DayPicker
          days={[{ id: 'a', label: 'Sat 24 Oct, 19:00', dow: 'Sat', num: '24', mon: 'Oct', time: '19:00' }]}
          selected={['a']}
          onToggle={noop}
        />
      </fieldset>
      <section aria-label="Predicted result">
        <FairnessMeter teamA="Red Wolves" teamB="Blue Herons" winA={0.46} winB={0.44} draw={0.1} sizes={[7, 6]} />
      </section>
      <TeamColumn side="a" sideLabel="Team A" bibs aria-labelledby="team-a" heading={<h3 id="team-a">Red Wolves</h3>}>
        <a href="/p1">Player 1</a>
      </TeamColumn>
      <Scoreboard teamA="Red Wolves" teamB="Blue Herons" scoreA={3} scoreB={2} bibs="a" status="provisional" />
      <SquadCard
        name="Thursday Ballers"
        meta={<RoleBadge role="admin" />}
        render={(props) => <button type="button" {...props} />}
      />
      <PlayerRow
        name="Priya Shah"
        role="group"
        aria-label="Priya Shah"
        nameContent={<a href="/players/priya">Priya Shah</a>}
        badges={<ProvisionalBadge short />}
        end={<Button variant="secondary" size="sm">Make admin</Button>}
      />
      <NotificationList>
        <li>
          <NotificationItem icon="calendar" accent unread time="2 min ago" render={(props) => <button type="button" {...props} />}>
            <span className="pm-sr">Unread</span> Thursday Ballers: new match drafted.
          </NotificationItem>
        </li>
        <li>
          <NotificationItem icon="trophy" time="Yesterday" render={(props) => <a href="/match" {...props} />}>
            You won 5–3.
          </NotificationItem>
        </li>
      </NotificationList>
    </main>
    </>
  );
}

afterEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe.each(THEMES)('shared components in the %s theme', (theme) => {
  it('pass the WCAG 2.1 A and AA audit', async () => {
    applyThemeAttribute(theme);
    const { container } = render(<Gallery />);
    await expectNoWcagViolations(container);
  });

  it('pass the audit with a dialog open', async () => {
    applyThemeAttribute(theme);
    render(
      <Dialog
        open
        title="Delete this squad?"
        icon="trash"
        tone="danger"
        onClose={noop}
        actions={
          <>
            <Button variant="ghost">Keep squad</Button>
            <Button variant="destructive">Delete squad</Button>
          </>
        }
      >
        <TextField label="Type the squad name to confirm" />
      </Dialog>,
    );
    await expectNoWcagViolations(screen.getByRole('dialog').parentElement!);
  });
});
