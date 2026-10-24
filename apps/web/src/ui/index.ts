/**
 * The shared component library, built from the PitchMate design system. Features
 * import it through this barrel only. Components read the `--pm-*` tokens from
 * `src/design`, know nothing of any feature or the API, and hold no domain logic:
 * a feature maps its data (wire enums, ratings) onto their props.
 */
export { Avatar, AvatarStack, type AvatarProps } from './Avatar';
export { Badge, FormerBadge, GuestBadge, ProvisionalBadge, RoleBadge, type BadgeProps, type BadgeTone } from './Badge';
export { BibFlag } from './BibFlag';
export { Button, IconButton, type ButtonProps, type IconButtonProps } from './Button';
export { Card, type CardProps } from './Card';
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
export { Icon, type IconName, type IconProps } from './Icon';
export { Logo, type LogoProps } from './Logo';
export { MatchProgress, MatchStateChip, type MatchStateName } from './MatchState';
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
export {
  SegmentedControl,
  Tabs,
  type SegmentedControlProps,
  type SegmentedOption,
  type TabItem,
  type TabsProps,
} from './Tabs';
export { Select, TextField, type SelectOption, type SelectProps, type TextFieldProps } from './TextField';
export { Toggle, type ToggleProps } from './Toggle';
export { TopBar, type TopBarProps } from './TopBar';
