"""Run offline backend/frontend regression checks and emit a machine-readable report."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default=str(ROOT / "backend/.cache/verification.json"))
    args = parser.parse_args()
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", ENABLE_WATSONX="false", ENABLE_WATSONX_BIOS="false", OPEN_STATES_API_KEY="", CLOUDANT_URL="")
    checks = []
    with tempfile.TemporaryDirectory() as temp:
        env["CACHE_PATH"] = str(Path(temp) / "test-cache.sqlite3")
        junit = Path(temp) / "backend.xml"
        jobs = [
            ("backend", [sys.executable, "-m", "pytest", "backend/tests", "-q", f"--junitxml={junit}"]),
            ("frontend", ["node", "--test", "--test-reporter=tap", *[str(p.relative_to(ROOT)) for p in sorted((ROOT / "tests").glob("*.test.js"))]]),
            ("diff", ["git", "diff", "--check"]),
        ]
        for name, command in jobs:
            try:
                result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
                count = 0
                if name == "backend" and junit.exists():
                    count = len(ET.parse(junit).findall(".//testcase"))
                elif name == "frontend":
                    match = re.search(r"^# tests (\d+)$", result.stdout, re.M)
                    count = int(match[1]) if match else 0
                checks.append({"name": name, "passed": result.returncode == 0, "tests": count})
                print(f"{name}: {'PASS' if result.returncode == 0 else 'FAIL'} ({count} tests)")
                if result.returncode:
                    print(result.stdout[-8000:])
                    print(result.stderr[-4000:])
            except OSError as error:
                checks.append({"name": name, "passed": False, "tests": 0})
                print(f"{name}: FAIL ({type(error).__name__}; check installed tools)")
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "passed": all(c["passed"] for c in checks), "tests": sum(c["tests"] for c in checks), "checks": checks, "scope": "Offline regression tests; not a live IBM integration or source-truth evaluation"}
    destination = Path(args.report)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Report: {destination}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
