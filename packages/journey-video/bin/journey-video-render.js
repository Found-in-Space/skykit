#!/usr/bin/env node
import { runJourneyVideoCli } from '../src/export-node.js';

runJourneyVideoCli().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
