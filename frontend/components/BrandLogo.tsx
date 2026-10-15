import { amcLogoSrc, insurerLogoSrc, normFirm, pmsLogoSrc } from "@/lib/brands";

// Firms without a logo file get a monogram on a colour derived from the name, so every row still has a mark.
function monogram(name: string): { text: string; bg: string } {
  const words = normFirm(name).split(" ").filter(Boolean);
  const text = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? name).slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { text, bg: `hsl(${h} 45% 38%)` };
}

function Tile({ src, name, className }: { src: string | null; name: string; className: string }) {
  return (
    <div
      className={`relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white px-1 shadow-sm ring-1 ring-black/10 ${className}`}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${name} logo`} className="h-full w-auto max-w-[6.5rem] object-contain py-1" loading="lazy" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[0.7em] font-bold text-white" style={{ background: monogram(name).bg }} aria-hidden="true">
          {monogram(name).text}
        </span>
      )}
    </div>
  );
}

export function InsurerLogo({ insurer, className = "h-9 min-w-9" }: { insurer: string; className?: string }) {
  return <Tile src={insurerLogoSrc(insurer)} name={insurer} className={className} />;
}

export function AmcLogo({ amc, className = "h-8 min-w-8" }: { amc: string; className?: string }) {
  return <Tile src={amcLogoSrc(amc)} name={amc} className={className} />;
}

export function AmcName({ amc, className = "h-8 min-w-8" }: { amc: string; className?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <AmcLogo amc={amc} className={className} />
      <span>{amc}</span>
    </span>
  );
}

export function PmsLogo({ firm, className = "h-8 min-w-8" }: { firm: string; className?: string }) {
  return <Tile src={pmsLogoSrc(firm)} name={firm} className={className} />;
}

export function PmsName({ firm, className = "h-8 min-w-8" }: { firm: string; className?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <PmsLogo firm={firm} className={className} />
      <span>{firm}</span>
    </span>
  );
}
