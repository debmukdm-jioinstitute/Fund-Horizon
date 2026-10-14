#!/usr/bin/env ts-node
/**
 * check-infotips.ts
 * Scans all backoffice pages for InfoTip usages and validates all metric keys against METRICS registry.
 */

import fs from "fs";
import path from "path";
import { METRICS } from "../frontend/lib/metrics/registry";

const BACKOFFICE_DIR = path.resolve(__dirname, "../frontend/app/backoffice");
const FUNDS_DIR = path.resolve(__dirname, "../frontend/app/funds");
const COMPONENTS_DIR = path.resolve(__dirname, "../frontend/components");
const REQUIRED_METRICS = [
  "ret_1m", "ret_1y", "cagr_3y", "cagr_5y", "xirr",
  "sharpe_3y", "sortino_3y", "vol_3y", "max_drawdown_3y",
  "up_capture", "down_capture", "quartile_rank", "ter",
  "aum", "nav", "pcr", "pcr_oi", "india_vix",
  "in_10y_yield", "us_10y_yield", "yield_spread_in_us", "inr_usd_fx",
  "fii_net_flow", "dii_net_flow",
  "correlation_r", "elasticity_beta", "r_squared", "modified_duration", "convexity",
  "source_health"
];

function findFiles(dir: string, ext = ".tsx"): string[] {
  let files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(findFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  console.log("Checking InfoTip coverage across app and backoffice pages...");
  const files = [
    ...findFiles(BACKOFFICE_DIR),
    ...findFiles(FUNDS_DIR),
    ...findFiles(COMPONENTS_DIR),
  ];
  const metricRegex = /metric=["']([a-zA-Z0-9_-]+)["']/g;

  let totalInfoTips = 0;
  const usedKeys = new Set<string>();
  const missingKeys: { file: string; key: string }[] = [];

  for (const f of files) {
    const content = fs.readFileSync(f, "utf-8");
    let match;
    while ((match = metricRegex.exec(content)) !== null) {
      totalInfoTips++;
      const key = match[1];
      usedKeys.add(key);
      if (!METRICS[key]) {
        missingKeys.push({ file: path.relative(process.cwd(), f), key });
      }
    }
  }

  console.log(`Found ${totalInfoTips} InfoTip usages across ${files.length} backoffice files.`);
  console.log(`Unique metric keys referenced: ${usedKeys.size}`);

  if (missingKeys.length > 0) {
    console.error(`ERROR: ${missingKeys.length} InfoTip usages reference unregistered metric keys:`);
    for (const m of missingKeys) {
      console.error(`  - ${m.key} in ${m.file}`);
    }
    process.exit(1);
  }

  // Check required core metrics are in registry
  const missingCore = REQUIRED_METRICS.filter((k) => !METRICS[k]);
  if (missingCore.length > 0) {
    console.error(`ERROR: Required core metrics missing from METRICS registry:`, missingCore);
    process.exit(1);
  }

  console.log("All InfoTip metric keys are valid and defined in METRICS registry!");
}

main();
