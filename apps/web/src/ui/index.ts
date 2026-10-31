/**
 * The shared component library, built from the PitchMate design system. Features
 * import it through this barrel only. Components read the `--pm-*` tokens from
 * `src/design`, know nothing of any feature or the API, and hold no domain logic:
 * a feature maps its data (wire enums, ratings) onto their props.
 */
export { ActionsMenu, type ActionsMenuProps } from './ActionsMenu';
export {
  AvailabilityGrid,
  AvailabilityKey,
  type AvailabilityAnswer,
  type AvailabilityGridCell,
  type AvailabilityGridDay,
  type AvailabilityGridProps,
  type AvailabilityGridRow,
  type AvailabilityGridTotal,
} from './AvailabilityGrid';
export { Avatar, AvatarStack, type AvatarProps } from './Avatar';
export { Badge, FormerBadge, GuestBadge, ProvisionalBadge, RoleBadge, type BadgeProps, type BadgeTone } from './Badge';
export { BibFlag, BibToggle, type BibToggleProps } from './BibFlag';
export { Button, IconButton, type ButtonProps, type IconButtonProps } from './Button';
export { buttonClasses, type ButtonClassOptions } from './buttonClasses';
export { Card, type CardProps } from './Card';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { Chip, type ChipProps } from './Chip';
export { Dialog, type DialogProps } from './Dialog';
export {
  Banner,
  EmptyState,
  ErrorState,
  NotFoundState,
  Skeleton,
  Toast,
  type BannerProps,
  type BannerTone,
  type EmptyStateProps,
  type ErrorStateProps,
  type NotFoundStateProps,
  type SkeletonProps,
  type ToastProps,
  type ToastTone,
} from './Feedback';
export { GoogleMark, type GoogleMarkProps } from './GoogleMark';
export { Icon, type IconName, type IconProps } from './Icon';
export { Logo, type LogoProps } from './Logo';
export {
  DayPicker,
  FairnessMeter,
  MatchCard,
  Scoreboard,
  TeamColumn,
  type DateParts,
  type DayOption,
  type DayPickerProps,
  type FairnessMeterProps,
  type MatchCardProps,
  type ScoreboardProps,
  type TeamColumnProps,
} from './Match';
export { MatchProgress, MatchStateChip, type MatchStateName } from './MatchState';
export { OptionCard, type OptionCardProps } from './OptionCard';
export { PlayerRow, type PlayerRowProps } from './PlayerRow';
export {
  SquadCard,
  SquadCrest,
  type SquadCardNextMatch,
  type SquadCardProps,
  type SquadCardRenderProps,
  type SquadCrestProps,
} from './Squad';
export {
  NotificationItem,
  NotificationList,
  type NotificationItemProps,
  type NotificationItemRenderProps,
  type NotificationListProps,
} from './NotificationList';
export { Rating, type RatingProps } from './Rating';
export { FormGuide, ResultBadge, type ResultLetter } from './Result';
export {
  NavItem,
  Sidebar,
  SidebarLabel,
  type NavItemProps,
  type NavItemRenderProps,
  type SidebarProps,
} from './Sidebar';
export { Steps, type StepsProps } from './Steps';
export {
  TeamSheetCard,
  TeamSheetPlayer,
  TeamSheetSide,
  type TeamSheetCardProps,
  type TeamSheetPlayerProps,
  type TeamSheetSideProps,
} from './TeamSheet';
export { TabNav, type TabNavItem, type TabNavLinkProps, type TabNavProps } from './TabNav';
export {
  SegmentedControl,
  Tabs,
  type SegmentedControlProps,
  type SegmentedOption,
  type TabItem,
  type TabsProps,
} from './Tabs';
export {
  LeaderboardRow,
  RatingChart,
  StatTile,
  type ChartPoint,
  type LeaderboardRowProps,
  type RatingChartProps,
  type StatTileProps,
} from './Stats';
export { Select, TextField, type SelectOption, type SelectProps, type TextFieldProps } from './TextField';
export { Toggle, type ToggleProps } from './Toggle';
export { TopBar, type TopBarProps } from './TopBar';
