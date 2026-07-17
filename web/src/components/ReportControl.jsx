import { useState } from 'react';
import { api } from '../api.js';

export default function ReportControl({ monthly }) {
  const months = monthly.map((m) => m.month).reverse();
  const [month, setMonth] = useState(months[0] || '');

  if (!months.length) return null;

  const href = api.reportHref(month);

  const linkCls =
    'border-b border-transparent text-[12.5px] font-semibold text-accent no-underline hover:border-accent';

  return (
    <p className="mb-3 flex items-center gap-2.5 text-[12.5px] text-muted">
      Monthly report:
      <select
        className="rounded-md border border-line bg-surface px-2 py-[5px] font-mono text-[12.5px] font-medium text-ink"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {href ? (
        <a className={linkCls} href={href}>Download</a>
      ) : (
        <a
          className={linkCls}
          href="#"
          onClick={(e) => {
            e.preventDefault();
            api.report(month);
          }}
        >
          Download
        </a>
      )}
    </p>
  );
}
