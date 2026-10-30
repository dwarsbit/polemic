"""Set the app version everywhere it is recorded.

Usage: python scripts/bump_version.py X.Y.Z

Updates package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
and src-tauri/Cargo.lock, and dates the "## X.Y.Z (unreleased)" heading
in CHANGELOG.md (which must exist).
"""

import datetime
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Windows installers (MSI) only take numeric versions, so no pre-releases.
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def replace(path, pattern, repl, count=1):
    file = ROOT / path
    text = file.read_text()
    new, n = re.subn(pattern, repl, text, count=count, flags=re.MULTILINE)
    if n != count:
        sys.exit(f"Expected {count} match(es) for {pattern!r} in {path}, found {n}")
    file.write_text(new)


def main(version):
    if not VERSION_RE.match(version):
        sys.exit(f"Invalid version {version!r}: expected X.Y.Z")

    # The changelog first: a missing heading fails before any file changes.
    today = datetime.date.today().isoformat()
    replace(
        "CHANGELOG.md",
        rf"^## {re.escape(version)} \(unreleased\)$",
        f"## {version} ({today})",
    )
    # The first "version" key: the top-level one.
    replace("package.json", r'^  "version": ".*",$', f'  "version": "{version}",')
    replace(
        "src-tauri/tauri.conf.json",
        r'^  "version": ".*",$',
        f'  "version": "{version}",',
    )
    replace("src-tauri/Cargo.toml", r'^version = ".*"$', f'version = "{version}"')
    replace(
        "src-tauri/Cargo.lock",
        r'^(name = "polemic"\nversion = )".*"$',
        rf'\g<1>"{version}"',
    )
    print(f"Version set to {version}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
