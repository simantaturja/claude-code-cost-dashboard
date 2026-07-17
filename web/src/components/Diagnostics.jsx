export default function Diagnostics({ summary, generatedAt }) {
  return (
    <p className="mt-[38px] border-t border-rule pt-4 font-mono text-[11.5px] leading-[1.6] text-faint">
      Plan multiple is API-equivalent value, not billing ·{' '}
      {summary.malformedLines} malformed lines skipped ·{' '}
      {summary.unknownModelMessages} messages with unknown model priced at $0 ·{' '}
      generated {new Date(generatedAt).toLocaleString()}
    </p>
  );
}
