// Claude Code hook → Deskfolk. Prints nothing (UserPromptSubmit stdout would
// become model context) and always exits 0, so it never blocks Claude Code.
import { hookSummary, launchPet, postToPet, readStdin } from './bridge-client.mjs';

try {
  const summary = hookSummary(JSON.parse(await readStdin()));
  const delivered = summary ? await postToPet('/claude-code', summary, 1500) : false;
  // A new session with no pet listening: start it if the user allows that.
  if (summary?.hook_event_name === 'SessionStart' && !delivered) await launchPet();
} catch {
  // Malformed input or a closed pet: nothing to report.
}
process.exit(0);
