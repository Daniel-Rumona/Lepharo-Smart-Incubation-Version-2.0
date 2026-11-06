// Never print function environment variables or raw CLI output.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { writeFileSync, mkdirSync } = require("node:fs");
try {
  const raw = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      'gcloud.cmd functions list --v2 --project lepharo-smart-inc --format="json(name,state,eventTrigger.eventFilters,updateTime,buildConfig.source)"',
    ],
    { encoding: "utf8", maxBuffer: 10e6, stdio: ["ignore", "pipe", "pipe"] }
  );
  const rows = JSON.parse(raw).map((f) => ({
    id: f.name.split("/").pop(),
    region: f.name.split("/")[3],
    state: f.state,
    updatedAt: f.updateTime,
    source: f.buildConfig?.source,
    eventTrigger: f.eventTrigger,
  }));
  mkdirSync("artifacts/digital-twin", { recursive: true });
  writeFileSync(
    "artifacts/digital-twin/deployed-functions.json",
    JSON.stringify(rows, null, 2)
  );
  console.log(
    JSON.stringify(rows.map(({ id, region, state }) => ({ id, region, state })))
  );
} catch {
  console.error(
    "Function inventory failed; raw output withheld because it may contain credentials."
  );
  process.exitCode = 1;
}
