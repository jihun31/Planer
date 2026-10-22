import { useId } from 'react';

const ranks = { rose:2, platinum:3, legend:4 };

// Keep all ornament inside the card; the frame never participates in its layout.
export default function LearningBadgeFrame({ tier }) {
  const id = useId();
  const rank = ranks[tier];
  if (!rank) return null;
  const metal = `url(#${id}-metal)`;
  const corners = 'M3 23V13L13 3H27L22 7H15L7 15V21Z M101 3H115L125 13V23L121 21V15L113 7H106Z M3 158V168L13 178H27L22 174H15L7 166V160Z M101 178H115L125 168V158L121 160V166L113 174H106Z';
  return <svg className="learning-badge-frame" viewBox="0 0 128 181" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id={`${id}-metal`} x1="0" y1="0" x2="128" y2="181" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--frame-light)" /><stop offset=".28" stopColor="var(--frame-mid)" />
      <stop offset=".48" stopColor="var(--frame-light)" /><stop offset=".7" stopColor="var(--frame-dark)" />
      <stop offset="1" stopColor="var(--frame-mid)" />
    </linearGradient></defs>
    <rect x="2.5" y="2.5" width="123" height="176" rx="11" fill="none" stroke={metal} strokeWidth="1.3" />
    <path d={corners} fill={metal} stroke="var(--frame-dark)" strokeWidth=".5" />
    <path d="M6 20V14L14 6H23 M105 6H114L122 14V20 M6 161V167L14 175H23 M105 175H114L122 167V161" fill="none" stroke="var(--frame-light)" strokeWidth=".8" />
    {rank >= 2 && <>
      <rect x="6" y="6" width="116" height="169" rx="7" fill="none" stroke="var(--frame-mid)" strokeWidth=".7" />
      <path d="M38 2H90L83 7H73L64 13L55 7H45Z M45 177L51 173H77L83 177Z" fill={metal} stroke="var(--frame-dark)" strokeWidth=".6" />
      <path d="M64 2L69 6L64 11L59 6Z" fill="var(--frame-gem)" stroke="var(--frame-light)" strokeWidth="1" />
      <path d="M64 3L64 9L60 6Z" fill="white" opacity=".4" />
    </>}
    {rank >= 3 && <>
      <path d="M3 15L11 9L8 23L4 37Z M125 15L117 9L120 23L124 37Z M3 166L11 172L8 158L4 144Z M125 166L117 172L120 158L124 144Z" fill={metal} stroke="var(--frame-dark)" strokeWidth=".6" />
      <path d="M4 17L8 14L5 30 M124 17L120 14L123 30 M4 164L8 167L5 151 M124 164L120 167L123 151" fill="none" stroke="var(--frame-light)" strokeWidth="1" />
      <path d="M49 3L55 9L51 12L41 5Z M79 3L73 9L77 12L87 5Z" fill="var(--frame-mid)" stroke="var(--frame-light)" strokeWidth=".7" />
    </>}
    {rank === 4 && <>
      <path d="M28 2L38 4L43 10L52 12L46 15L36 10Z M100 2L90 4L85 10L76 12L82 15L92 10Z" fill={metal} stroke="var(--frame-dark)" strokeWidth=".7" />
      <path d="M3 39L9 46L6 61L3 67Z M125 39L119 46L122 61L125 67Z M3 142L9 135L6 120L3 114Z M125 142L119 135L122 120L125 114Z" fill="var(--frame-gem)" stroke="var(--frame-mid)" strokeWidth=".8" />
      <path d="M56 176L64 170L72 176L64 179Z" fill={metal} stroke="var(--frame-dark)" strokeWidth=".6" />
    </>}
  </svg>;
}
