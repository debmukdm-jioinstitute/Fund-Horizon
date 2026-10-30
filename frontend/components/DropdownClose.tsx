"use client";

/** The ✕ shown at the top of every dropdown panel. Use `as="li"` inside a <ul>. */
export default function DropdownClose({ onClose, as = "div" }: { onClose: () => void; as?: "div" | "li" }) {
  const Tag = as;
  return (
    <Tag className="dropdown-close-row" role="presentation">
      <button type="button" aria-label="Close" title="Close" className="dropdown-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
    </Tag>
  );
}
