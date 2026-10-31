/**
 * Behaviour of the shared components: accessible names and states, the
 * never-colour-alone rules, and the controlled interactions.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Avatar,
  AvatarStack,
  Banner,
  BibFlag,
  BibToggle,
  Button,
  Checkbox,
  Chip,
  EmptyState,
  ErrorState,
  FormGuide,
  GoogleMark,
  GuestBadge,
  IconButton,
  Logo,
  MatchProgress,
  MatchStateChip,
  NavItem,
  NotFoundState,
  NotificationItem,
  NotificationList,
  PlayerRow,
  ProvisionalBadge,
  Rating,
  ResultBadge,
  RoleBadge,
  SegmentedControl,
  Select,
  Sidebar,
  SidebarLabel,
  SquadCard,
  SquadCrest,
  Tabs,
  TextField,
  Toast,
  Toggle,
  TopBar,
} from '.';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Roll teams</Button>);
    expect(screen.getByRole('button', { name: 'Roll teams' })).toHaveAttribute('type', 'button');
  });

  it('announces loading with aria-busy and keeps its name', () => {
    render(<Button loading>Lock teams</Button>);
    expect(screen.getByRole('button', { name: 'Lock teams' })).toHaveAttribute('aria-busy', 'true');
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Complete match</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Complete match' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('EmptyState', () => {
  it('can be the page heading, carry attributes, and announce its message', () => {
    render(
      <EmptyState
        headingLevel={1}
        title="Squad not found"
        data-testid="state"
        bodyProps={{ role: 'status' }}
      >
        It may have been removed.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Squad not found' })).toBeInTheDocument();
    expect(screen.getByTestId('state')).toHaveClass('pm-empty');
    expect(screen.getByRole('status')).toHaveTextContent('It may have been removed.');
  });

  it('has no heading when it sits under one of its own', () => {
    render(<EmptyState tone="error">That did not load.</EmptyState>);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('That did not load.')).toBeInTheDocument();
  });
});

describe('Banner', () => {
  it('announces itself by tone unless the caller owns the live region', () => {
    const { rerender } = render(<Banner tone="error">That email and password don't match.</Banner>);
    expect(screen.getByRole('alert')).toHaveTextContent("That email and password don't match.");

    rerender(
      <Banner tone="error" announce={false}>
        That email and password don't match.
      </Banner>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText("That email and password don't match.")).toBeInTheDocument();
  });
});

describe('GoogleMark', () => {
  it('is decorative, so the button label alone names the provider', () => {
    render(
      <button type="button">
        <GoogleMark />
        Continue with Google
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('IconButton', () => {
  it('takes its accessible name from the label', () => {
    render(<IconButton icon="more" label="More actions" />);
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });
});

describe('TextField', () => {
  it('labels the input and links the hint', () => {
    render(<TextField label="Email" hint="We'll send a link" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription("We'll send a link");
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks an error invalid and describes it instead of the hint', () => {
    render(<TextField label="Email" hint="We'll send a link" error="Add the rest of your email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Add the rest of your email');
  });

  it('gives two fields with the same label distinct ids', () => {
    render(
      <>
        <TextField label="Name" />
        <TextField label="Name" />
      </>,
    );
    const [first, second] = screen.getAllByLabelText('Name');
    expect(first.id).not.toBe(second.id);
  });
});

describe('Select', () => {
  it('renders string and labelled options', () => {
    render(<Select label="Tier" options={['Beginner', { value: 'avg', label: 'Average' }]} />);
    expect(screen.getByRole('combobox', { name: 'Tier' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Average' })).toHaveValue('avg');
  });
});

describe('Toggle', () => {
  it('is a switch that flips and reports its state', async () => {
    const onChange = vi.fn();
    render(<Toggle label="Live tracking" onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Live tracking' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Checkbox', () => {
  it('is named by its label, even when the label is hidden, and reports a change', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Guest Gary" hideLabel checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Guest Gary' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('draws a tick when checked, so the state is not colour alone', () => {
    const { container } = render(<Checkbox label="Guests pay too" checked onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Guests pay too' })).toBeChecked();
    expect(container.querySelector('.pm-check__box svg')).not.toBeNull();
  });
});

describe('BibToggle', () => {
  it('says whether the team wears the bibs in words and as aria-pressed', () => {
    render(
      <>
        <BibToggle pressed pressedLabel="Wearing bibs" label="Wear bibs" />
        <BibToggle pressed={false} pressedLabel="Wearing bibs" label="Wear bibs" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Wearing bibs' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Wear bibs' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Chip', () => {
  it('exposes its selection as aria-pressed', () => {
    render(<Chip selected>Guests</Chip>);
    expect(screen.getByRole('button', { name: 'Guests' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('badges', () => {
  it('gives members no role badge', () => {
    const { container } = render(<RoleBadge role="member" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels owners and admins in words', () => {
    render(
      <>
        <RoleBadge role="owner" />
        <RoleBadge role="admin" />
      </>,
    );
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('always spells out provisional with the ~', () => {
    render(
      <>
        <ProvisionalBadge />
        <ProvisionalBadge short />
        <GuestBadge />
      </>,
    );
    expect(screen.getByText('~ Provisional')).toBeInTheDocument();
    expect(screen.getByText('~ Prov')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });
});

describe('Rating', () => {
  it('shows the value with a signed delta', () => {
    render(
      <>
        <Rating value="1,240" delta={12} />
        <Rating value="1,180" delta={-8} />
      </>,
    );
    expect(screen.getByText('▲ +12')).toBeInTheDocument();
    expect(screen.getByText('▼ -8')).toBeInTheDocument();
  });

  it('shows only the band for a provisional player', () => {
    const { container } = render(<Rating provisional band="1,1xx" />);
    expect(container).toHaveTextContent('~1,1xx');
    expect(screen.getByText('~ Prov')).toBeInTheDocument();
  });
});

describe('results', () => {
  it('names each result in words and shows its letter', () => {
    render(
      <>
        <ResultBadge result="W" />
        <ResultBadge result="L" />
        <ResultBadge result="D" />
      </>,
    );
    for (const [word, letter] of [
      ['Win', 'W'],
      ['Loss', 'L'],
      ['Draw', 'D'],
    ]) {
      expect(screen.getByRole('img', { name: word })).toHaveTextContent(letter);
    }
  });

  it('reads a form guide as one sentence', () => {
    render(<FormGuide results={['W', 'D', 'L']} />);
    expect(screen.getByRole('img', { name: 'Last 3: Win, Draw, Loss' })).toBeInTheDocument();
  });
});

describe('match state', () => {
  it('puts a word beside every state colour', () => {
    render(<MatchStateChip state="rolled" />);
    expect(screen.getByText('Teams rolled')).toBeInTheDocument();
  });

  it('names the current step of the progress bar', () => {
    render(<MatchProgress state="live" />);
    expect(screen.getByRole('img', { name: 'Match progress: In progress' })).toBeInTheDocument();
  });
});

describe('BibFlag', () => {
  it('says which team wears bibs, and the other says it does not', () => {
    render(
      <>
        <BibFlag />
        <BibFlag off />
      </>,
    );
    expect(screen.getByRole('img', { name: 'This team wears bibs' })).toBeInTheDocument();
    expect(screen.getByText('No bibs')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('shows up to two initials and is hidden from assistive technology', () => {
    const { container } = render(<Avatar name="Sam Ade Okafor" />);
    expect(container.firstElementChild).toHaveTextContent('SA');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes initials from letters and digits only, skipping punctuation', () => {
    expect(render(<Avatar name="Kev (Sam’s mate)" />).container.firstElementChild).toHaveTextContent('KS');
    expect(render(<Avatar name="- Ünal 7s" />).container.firstElementChild).toHaveTextContent('Ü7');
  });

  it('keeps a name on the same tint every time', () => {
    const first = render(<Avatar name="Priya" />).container.firstElementChild?.className;
    const second = render(<Avatar name="Priya" />).container.firstElementChild?.className;
    expect(first).toBe(second);
  });

  it('counts the players beyond the stack', () => {
    const { container } = render(<AvatarStack names={['A', 'B', 'C', 'D', 'E', 'F']} max={4} />);
    expect(container).toHaveTextContent('+2');
  });
});

describe('Logo', () => {
  it('is one image named PitchMate, or a link when given an href', () => {
    render(
      <>
        <Logo />
        <Logo href="/" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'PitchMate' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PitchMate' })).toHaveAttribute('href', '/');
  });

  it('is named by its wordmark text inside a control, with decorative marks', () => {
    render(
      <a href="/app">
        <Logo textName />
      </a>,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PitchMate' })).toBeInTheDocument();
  });
});

describe('TopBar', () => {
  it('is a banner holding what it is given', () => {
    render(
      <TopBar>
        <Logo href="/" />
      </TopBar>,
    );
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('link', { name: 'PitchMate' }));
  });
});

describe('Sidebar and NavItem', () => {
  it('is a named navigation landmark only when labelled', () => {
    const { rerender } = render(<Sidebar label="Squad">x</Sidebar>);
    expect(screen.getByRole('navigation', { name: 'Squad' })).toBeInTheDocument();
    rerender(<Sidebar>x</Sidebar>);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('hands its element the active class, aria-current and its contents', () => {
    render(
      <Sidebar label="Squad">
        <SidebarLabel>Your squads</SidebarLabel>
        <NavItem label="Players" icon="users" active render={(props) => <a href="/players" {...props} />} />
        <NavItem label="Matches" icon="calendar" render={(props) => <a href="/matches" {...props} />} />
      </Sidebar>,
    );
    const players = screen.getByRole('link', { name: 'Players' });
    expect(players).toHaveAttribute('aria-current', 'page');
    expect(players).toHaveClass('pm-navitem', 'is-active');
    expect(screen.getByRole('link', { name: 'Matches' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Your squads')).toBeInTheDocument();
  });
});

describe('SquadCard and SquadCrest', () => {
  it('is one control named by the squad and its meta, with a decorative crest', async () => {
    const onClick = vi.fn();
    render(
      <SquadCard
        name="Thursday Ballers"
        meta={<span>Owner</span>}
        render={(props) => <button type="button" onClick={onClick} {...props} />}
      />,
    );
    const card = screen.getByRole('button', { name: 'Thursday Ballers Owner' });
    expect(card).toHaveClass('pm-card', 'pm-squadcard');
    expect(card.querySelector('.pm-crest')).toHaveAttribute('aria-hidden', 'true');
    expect(card.querySelector('.pm-crest')).toHaveTextContent('TB');
    await userEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('reads the next match and the form as part of the one control', () => {
    render(
      <SquadCard
        name="Thursday Ballers"
        meta={<span>14 players</span>}
        next={{ state: 'rolled', title: 'Sun 9 Nov · 10:00', sub: 'Hackney Marshes' }}
        form={['W', 'D', 'L']}
        render={(props) => <button type="button" {...props} />}
      />,
    );
    const card = screen.getByRole('button', {
      name: 'Thursday Ballers 14 players Teams rolled Sun 9 Nov · 10:00 Hackney Marshes Form Last 3: Win, Draw, Loss',
    });
    expect(card.querySelector('.pm-squadcard__next')).not.toHaveClass('pm-squadcard__next--none');
  });

  it('says so when there is no next match and no form, and leaves out what is not supplied', () => {
    const { rerender } = render(
      <SquadCard
        name="Uni Old Boys"
        next={null}
        noNextMatch="Nothing planned yet"
        form={[]}
        noForm="No games yet"
        render={(props) => <button type="button" {...props} />}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Uni Old Boys Nothing planned yet Form No games yet' }),
    ).toBeInTheDocument();

    rerender(<SquadCard name="Uni Old Boys" render={(props) => <button type="button" {...props} />} />);
    const card = screen.getByRole('button', { name: 'Uni Old Boys' });
    expect(card.querySelector('.pm-squadcard__next')).toBeNull();
    expect(card.querySelector('.pm-squadcard__foot')).toBeNull();
  });

  it('uses a chosen crest over the initials', () => {
    const { container } = render(<SquadCrest name="Thursday Ballers" crest="⚽" size="sm" />);
    expect(container.firstElementChild).toHaveTextContent('⚽');
    expect(container.firstElementChild).toHaveClass('pm-crest--sm');
  });
});

describe('PlayerRow', () => {
  it('lays out the name, badges and trailing column, passing attributes to the row', () => {
    render(
      <PlayerRow
        name="Big Dave"
        guest
        role="group"
        aria-label="Big Dave"
        nameContent={<button type="button">Big Dave</button>}
        badges={<GuestBadge />}
        meta="12 appearances"
        end={<Rating value="1,240" />}
      />,
    );
    const row = screen.getByRole('group', { name: 'Big Dave' });
    expect(row).toHaveClass('pm-player');
    expect(screen.getByRole('button', { name: 'Big Dave' })).toBeInTheDocument();
    expect(row).toHaveTextContent('Guest');
    expect(row).toHaveTextContent('12 appearances');
    expect(row).toHaveTextContent('1,240');
    // The default-size avatar needs no inline style.
    expect(row.querySelector('.pm-avatar')).not.toHaveAttribute('style');
  });

  it('mutes a former player', () => {
    const { container } = render(<PlayerRow name="Former player" former />);
    expect(container.firstElementChild).toHaveClass('is-former');
  });
});

describe('NotificationList and NotificationItem', () => {
  it('renders each row through the caller element, with the time under the text', async () => {
    const onClick = vi.fn();
    render(
      <NotificationList>
        <li>
          <NotificationItem
            icon="calendar"
            unread
            time="2 min ago"
            render={(props) => <button type="button" onClick={onClick} {...props} />}
          >
            <span className="pm-sr">Unread</span> New match drafted
          </NotificationItem>
        </li>
      </NotificationList>,
    );
    const row = screen.getByRole('button', { name: /Unread\s+New match drafted\s*2 min ago/ });
    expect(row).toHaveClass('pm-notif', 'is-unread');
    await userEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('list')).toHaveClass('pm-notifs');
  });
});

function TabsHarness() {
  const [active, setActive] = useState('players');
  return (
    <Tabs
      label="Squad sections"
      active={active}
      onChange={setActive}
      tabs={[
        { id: 'players', label: 'Players', count: 14 },
        { id: 'matches', label: 'Matches' },
        { id: 'admin', label: 'Admin', disabled: true },
        { id: 'stats', label: 'Stats' },
      ]}
    />
  );
}

describe('Tabs', () => {
  it('has one tab stop, on the selected tab', () => {
    render(<TabsHarness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
  });

  it('moves and selects with the arrow keys, skipping disabled tabs and wrapping', async () => {
    render(<TabsHarness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Matches' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Players/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveFocus();
  });
});

function SegmentedHarness() {
  const [value, setValue] = useState('appearances');
  return (
    <SegmentedControl
      label="Rank by"
      value={value}
      onChange={setValue}
      options={[
        { value: 'appearances', label: 'Appearances' },
        { value: 'rating', label: 'Rating' },
        { value: 'bibs', label: 'Bibs' },
      ]}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radio group that the arrow keys move through', async () => {
    render(<SegmentedHarness />);
    expect(screen.getByRole('radiogroup', { name: 'Rank by' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Appearances' }));
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Bibs' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Bibs' })).toHaveFocus();
  });
});

describe('feedback states', () => {
  it('retries from the error state', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says the same thing whether content is missing or not shared', () => {
    const { container } = render(<NotFoundState />);
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(container).toHaveTextContent("This page doesn't exist, or it isn't shared with you.");
  });

  it('runs a toast action', async () => {
    const onAction = vi.fn();
    render(
      <Toast actionLabel="Undo" onAction={onAction}>
        Goal recorded
      </Toast>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Goal recorded');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
