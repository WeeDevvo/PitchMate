/**
 * StatsShowcase — the pitch for squad stats: an example leaderboard beside the
 * copy and three example stat tiles.
 *
 * The leaderboard is the design system's `LeaderboardRow` in an `ol` and the
 * tiles are `StatTile`s in a `dl`, as on the real stats screens. The leaderboard
 * is a `figure` with a caption for assistive technology.
 */
import { landingContent, type LandingContent } from '../content/landingContent'
import { Card, GuestBadge, LeaderboardRow, StatTile } from '../../../ui'

export interface StatsShowcaseProps {
  /** The content model supplying the copy and example figures. */
  content?: LandingContent
}

export function StatsShowcase({ content = landingContent }: StatsShowcaseProps) {
  const { id, heading, headingAccent, description, exampleCaption, leaderboardTitle, standings, tiles } =
    content.stats
  const headingId = `${id}-heading`

  return (
    <section id={id} className="stats" aria-labelledby={headingId}>
      <figure className="stats__visual">
        <figcaption className="pm-sr">{exampleCaption}</figcaption>
        <Card className="stats__board">
          <p className="landing-overline stats__board-title" aria-hidden="true">
            {leaderboardTitle}
          </p>
          <ol className="stats__standings">
            {standings.map((standing) => (
              <LeaderboardRow
                key={standing.name}
                rank={standing.rank}
                first={standing.rank === 1}
                me={standing.me}
                name={
                  <>
                    {standing.name}
                    {standing.guest && <GuestBadge />}
                  </>
                }
                value={standing.value}
                sub={standing.record}
              />
            ))}
          </ol>
        </Card>
      </figure>
      <div className="stats__copy">
        <h2 id={headingId} className="landing-display stats__heading">
          {heading} <span className="landing-break">{headingAccent}</span>
        </h2>
        <p className="stats__description">{description}</p>
        <dl className="stats__tiles">
          {tiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} sub={tile.sub} icon={tile.icon} tone={tile.tone} />
          ))}
        </dl>
      </div>
    </section>
  )
}

export default StatsShowcase
