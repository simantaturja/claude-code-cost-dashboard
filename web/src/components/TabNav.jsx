const LABELS = {
  overview: 'Overview',
  breakdown: 'Breakdown',
  advisor: 'Advisor',
  waste: 'Waste',
  sessions: 'Sessions',
};

export default function TabNav({ tabs, active }) {
  return (
    <nav className="flex gap-0.5 self-stretch">
      {tabs.map((t) => (
        <button
          key={t}
          className={
            '-mb-px cursor-pointer border-b-2 bg-transparent px-[13px] text-[13px] leading-none tracking-[0.01em] transition-colors focus-visible:rounded-[3px] focus-visible:outline-2 focus-visible:outline-accent ' +
            (t === active
              ? 'border-chart font-semibold text-ink'
              : 'border-transparent font-medium text-muted hover:text-ink')
          }
          aria-current={t === active ? 'page' : undefined}
          onClick={() => {
            window.location.hash = t;
          }}
        >
          {LABELS[t]}
        </button>
      ))}
    </nav>
  );
}
