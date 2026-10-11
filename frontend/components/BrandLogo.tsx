import { amcLogoSrc, insurerLogoSrc } from "@/lib/brands";

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
        <span className="text-[0.7em] font-bold text-navy-900" aria-hidden="true">
          {name.slice(0, 2).toUpperCase()}
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
