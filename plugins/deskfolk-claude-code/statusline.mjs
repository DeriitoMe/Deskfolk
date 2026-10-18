// Claude Code status line: shows "Current session: xx%" and passes the
// five-hour window (the only quota data Claude Code exposes locally) to Deskfolk.
import { postToPet, readStdin, statusSummary } from './bridge-client.mjs';

let input = {};
try { input = JSON.parse(await readStdin()); } catch { input = {}; }

const parts = [];
const model = input?.model?.display_name;
if (typeof model === 'string' && model) parts.push(model);
const used = input?.rate_limits?.five_hour?.used_percentage;
if (typeof used === 'number' && Number.isFinite(used)) parts.push(`Current session: ${Math.round(used)}%`);
process.stdout.write(parts.join(' · ') + '\n');

await postToPet('/claude-code/status', statusSummary(input), 800);
process.exit(0);
