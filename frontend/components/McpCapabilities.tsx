const ROWS: [string, string, string][] = [
  ["Research", "Screen mutual funds, quartiles, FH score breakdown, peers, overlap, fund managers. Search PMS strategies, matrix, providers, FH Recommended lists. Compare and crunch numbers.", "Invent or estimate a figure. Fill an empty cell. Give investment advice. Show Direct-plan quartiles (the source publishes Regular only)."],
  ["CRM", "Read, add, change and delete households, clients and their holdings: mutual fund, PMS, stocks, anything else.", "Do more than your role allows. Change or delete before showing you the change and getting your clear yes."],
  ["Valuation", "Upload statements (FundsIndia, ProAffluence, Stallion and more), process, validate, reconcile, fix or add a holding, discard an unapproved batch, build the consolidated report PDF.", "Edit an approved valuation (it is frozen). Approve without your yes. Hide a mismatch: it must be fixed first."],
  ["Forms", "Fill the official CAMS, KFintech and PMS PDFs for a client.", "Make a lookalike form, invent a form code, or sign for you."],
  ["Everything else", "Any other Fund Horizon screen or API, including features added later, with no reinstall. Every change is logged with its old values: ask \"show my recent changes\".", "Touch logins, passwords, connection tokens or staff accounts. Those stay inside Fund Horizon."],
  ["You", "Ask in plain words. Check the as-on date Claude quotes. Remove a lost connection in Settings and download a new one.", "Share your connector file (it holds your sign-in). Say yes before you have read the change."],
];

export default function McpCapabilities() {
  return (
    <div className="overflow-x-auto">
      <table className="terminal-table w-full text-[14px] leading-snug">
        <thead><tr><th className="text-left">Area</th><th className="text-left text-[#1B5E20] dark:text-[#A5D6A7]">Do</th><th className="text-left text-[#B42332] dark:text-[#FF7D86]">Do not</th></tr></thead>
        <tbody>
          {ROWS.map(([area, yes, no]) => (
            <tr key={area} className="align-top"><td className="whitespace-nowrap font-semibold">{area}</td><td>{yes}</td><td>{no}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
