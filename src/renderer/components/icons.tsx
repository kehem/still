import type { ReactNode, SVGProps } from 'react';

/** Minimal stroke icons (Lucide-style), drawn inline — no icon dependency. */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function createIcon(paths: ReactNode) {
  return function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const InboxIcon = createIcon(
  <>
    <path d="M3 9l3-6h12l3 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path d="M3 9h5l2 3h4l2-3h5" />
  </>,
);

export const SendIcon = createIcon(
  <>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </>,
);

export const FileTextIcon = createIcon(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M9 13h6M9 17h6" />
  </>,
);

export const ArchiveIcon = createIcon(
  <>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
    <path d="M10 13h4" />
  </>,
);

export const ClockIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);

export const TrashIcon = createIcon(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </>,
);

export const BellIcon = createIcon(
  <>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
    <path d="M13.7 20a2 2 0 0 1-3.4 0" />
  </>,
);

export const GearIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
  </>,
);

export const SearchIcon = createIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>,
);

export const PenIcon = createIcon(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </>,
);

export const ChevronLeftIcon = createIcon(<path d="m15 18-6-6 6-6" />);
export const ChevronRightIcon = createIcon(<path d="m9 18 6-6-6-6" />);
// Star, flag and mail glyphs are intentionally absent: the message actions
// that would render them (star, flag) arrive in Phase 3. Adding an icon before
// its consumer is dead code.
export const PaperclipIcon = createIcon(
  <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
);

export const XIcon = createIcon(<path d="M18 6 6 18M6 6l12 12" />);
export const PlusIcon = createIcon(<path d="M12 5v14M5 12h14" />);
export const CheckIcon = createIcon(<path d="M20 6 9 17l-5-5" />);

export const RefreshIcon = createIcon(
  <>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </>,
);

export const SunIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);

export const MoonIcon = createIcon(
  <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />,
);

export const MonitorIcon = createIcon(
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </>,
);

export const ArrowRightIcon = createIcon(
  <>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </>,
);

export const ReplyIcon = createIcon(
  <>
    <path d="M9 17l-5-5 5-5" />
    <path d="M4 12h9a7 7 0 0 1 7 7v1" />
  </>,
);

export const ForwardIcon = createIcon(
  <>
    <path d="m15 17 5-5-5-5" />
    <path d="M20 12h-9a7 7 0 0 0-7 7v1" />
  </>,
);
