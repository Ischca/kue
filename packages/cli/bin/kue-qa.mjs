#!/usr/bin/env node
import { main } from "../src/init.mjs";
import { check } from "../src/check.mjs";
try {
  const args = process.argv.slice(2);
  if (args[0] === "check") await check(args.slice(1));
  else await main(args);
}
catch (error) { console.error(`KUE: ${error.message}`); process.exitCode = 1; }
