"use client";

import React from "react";
import { useAcademy } from "./AcademyContext";
import { btnPrimary, card, muted } from "./ui";

/** Shown once every module final quiz is passed. Printing uses a print stylesheet that shows only the certificate. */
export function Certificate() {
  const { me } = useAcademy();
  if (!me?.certificate) return null;
  const entries = Object.entries(me.certificate);
  const date = entries.map(([, c]) => c.date).sort().at(-1);
  return (
    <section aria-label="Certificate" className={`${card} p-6 space-y-4`}>
      <style>{`@media print{body *{visibility:hidden}#fh-cert,#fh-cert *{visibility:visible}#fh-cert{position:fixed;inset:0;display:flex!important;background:#fff;color:#172033}}`}</style>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">🏆 Certificate ready</h3>
          <p className={`text-[15px] ${muted}`}>You passed every module final quiz ({entries.length} in all). Print or save it as a PDF.</p>
        </div>
        <button className={btnPrimary} onClick={() => window.print()}>Print certificate</button>
      </div>
      <div id="fh-cert" className="hidden print:flex flex-col items-center justify-center text-center p-16 border-8 border-double border-[#0176D3] gap-4">
        <div className="text-sm tracking-widest uppercase">Fund Horizon Academy</div>
        <h1 className="text-4xl font-semibold">Certificate of Completion</h1>
        <p className="text-lg">This certifies that</p>
        <p className="text-3xl font-semibold">{me.name}</p>
        <p className="text-lg">has completed the L.E.A.R.N. distributor training and passed the final quizzes:</p>
        <ul className="text-lg">{entries.map(([m, c]) => <li key={m}>{c.title ?? m}: {c.score}/{c.total}</li>)}</ul>
        <p className="text-base">Date (IST): {date}</p>
      </div>
    </section>
  );
}
