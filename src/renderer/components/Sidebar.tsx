import type { ReactNode } from 'react';
import type { Account } from '../../shared/types';
import { ALL_INBOX } from '../../shared/constants';
import {
  ArchiveIcon,
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FileTextIcon,
  GearIcon,
  InboxIcon,
  SendIcon,
  TrashIcon,
} from './icons';


interface SidebarProps {
  accounts: Account[];
  activeFolder: string;
  onSelectFolder: (folder: string) => void;
  onOpenAutomation: () => void;
  automationActive: boolean;
  onOpenFollowUps: () => void;
  onOpenSettings: () => void;
  followUpsActive: boolean;
  settingsActive: boolean;
  dueCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Hidden when the unified inbox is turned off in Settings → Inbox. */
  showAllInbox: boolean;
}

function NavItem({
  icon,
  label,
  badge,
  active,
  collapsed,
  onClick,
  dotColor,
}: {
  icon: ReactNode;
  label: string;
  badge?: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  dotColor?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? 'bg-surface-hover font-medium text-text'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text'
      } ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {dotColor ? (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      ) : (
        <span className="shrink-0">{icon}</span>
      )}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="text-[11px] font-medium text-text-tertiary">{badge}</span>
      )}
    </button>
  );
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="my-2 border-t border-border" />;
  return (
    <div className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
      {children}
    </div>
  );
}

export function Sidebar({
  accounts,
  activeFolder,
  onSelectFolder,
  onOpenFollowUps,
  onOpenAutomation,
  automationActive,
  onOpenSettings,
  followUpsActive,
  settingsActive,
  dueCount,
  collapsed,
  onToggleCollapsed,
  showAllInbox,
}: SidebarProps) {
  return (
    <nav
      className={`flex shrink-0 flex-col border-r border-border py-2 ${
        collapsed ? 'w-14 items-center px-1.5' : 'w-56 px-2'
      }`}
    >
      <div className="flex-1 overflow-y-auto">
        <SectionLabel collapsed={collapsed}>Mail</SectionLabel>
        {showAllInbox && (
          <NavItem
            icon={<InboxIcon size={17} />}
            label="All Inbox"
            active={activeFolder === ALL_INBOX && !followUpsActive && !settingsActive}
            collapsed={collapsed}
            onClick={() => onSelectFolder(ALL_INBOX)}
          />
        )}
        {accounts.map((account) => (
          <NavItem
            key={account.id}
            icon={<InboxIcon size={17} />}
            label={account.displayName}
            dotColor={account.color}
            active={activeFolder === account.id}
            collapsed={collapsed}
            onClick={() => onSelectFolder(account.id)}
          />
        ))}

        <SectionLabel collapsed={collapsed}>Folders</SectionLabel>
        <NavItem
          icon={<SendIcon size={17} />}
          label="Sent"
          active={activeFolder === 'sent'}
          collapsed={collapsed}
          onClick={() => onSelectFolder('sent')}
        />
        <NavItem
          icon={<FileTextIcon size={17} />}
          label="Drafts"
          active={activeFolder === 'drafts'}
          collapsed={collapsed}
          onClick={() => onSelectFolder('drafts')}
        />
        <NavItem
          icon={<ArchiveIcon size={17} />}
          label="Archive"
          active={activeFolder === 'archive'}
          collapsed={collapsed}
          onClick={() => onSelectFolder('archive')}
        />
        <NavItem
          icon={<ClockIcon size={17} />}
          label="Snoozed"
          active={activeFolder === 'snoozed'}
          collapsed={collapsed}
          onClick={() => onSelectFolder('snoozed')}
        />
        <NavItem
          icon={<TrashIcon size={17} />}
          label="Trash"
          active={activeFolder === 'trash'}
          collapsed={collapsed}
          onClick={() => onSelectFolder('trash')}
        />

        <SectionLabel collapsed={collapsed}>Productivity</SectionLabel>
        <NavItem icon={<SendIcon size={17} />} label="Automation" active={automationActive} collapsed={collapsed} onClick={onOpenAutomation} />
        <NavItem
          icon={<BellIcon size={17} />}
          label="Follow-ups"
          badge={dueCount}
          active={followUpsActive}
          collapsed={collapsed}
          onClick={onOpenFollowUps}
        />
      </div>

      <div className="border-t border-border pt-2">
        <NavItem
          icon={<GearIcon size={17} />}
          label="Settings"
          active={settingsActive}
          collapsed={collapsed}
          onClick={onOpenSettings}
        />
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          {collapsed ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
