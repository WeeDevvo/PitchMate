/**
 * HowItWorks — the numbered steps from squad to bragging rights, beside an
 * example team sheet.
 *
 * The steps are an ordered list with `<h3>` headings under the section's `<h2>`,
 * so the outline stays unbroken. The team sheet is built from the design
 * system's `TeamColumn` and `PlayerRow`, as the real match screens are; it is a
 * `figure` with a caption, and its team names are not headings, so the example
 * never pollutes the page's outline.
 */
import { landingContent, type LandingContent } from '../content/landingContent'
import { GuestBadge, PlayerRow, TeamColumn } from '../../../ui'

export interface HowItWorksProps {
  /** The content model supplying the steps and example teams. */
  content?: LandingContent
}

export function HowItWorks({ content = landingContent }: HowItWorksProps) {
  const { id, heading, steps, exampleCaption, teams } = content.howItWorks
  const headingId = `${id}-heading`

  return (
    <section id={id} className="how" aria-labelledby={headingId}>
      <div className="how__inner">
        <div className="how__copy">
          <h2 id={headingId} className="landing-display how__heading">
            {heading}
          </h2>
          <ol className="how__steps">
            {steps.map((step, index) => (
              <li key={step.heading} className="how__step">
                <span className="how__number pm-num" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3 className="how__step-heading">{step.heading}</h3>
                  <p className="how__step-text">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <figure className="how__visual">
          <figcaption className="pm-sr">{exampleCaption}</figcaption>
          <div className="how__teams">
            {teams.map((team, index) => (
              <TeamColumn
                key={team.name}
                side={index === 0 ? 'a' : 'b'}
                sideLabel={index === 0 ? 'Team A' : 'Team B'}
                bibs={team.bibs}
                heading={<p className="how__team-name">{team.name}</p>}
                meta={`${team.players.length} players · avg ${team.average}`}
              >
                {team.players.map((player) => (
                  <PlayerRow
                    key={player.name}
                    name={player.name}
                    guest={player.guest}
                    badges={player.guest ? <GuestBadge /> : undefined}
                    end={<span className="pm-num how__score">{player.score}</span>}
                  />
                ))}
              </TeamColumn>
            ))}
          </div>
        </figure>
      </div>
    </section>
  )
}

export default HowItWorks
