#!/usr/bin/env node
import { main } from "../src/init.mjs";
try { await main(process.argv.slice(2)); }
catch (error) { console.error(`KUE: ${error.message}`); process.exitCode = 1; }
