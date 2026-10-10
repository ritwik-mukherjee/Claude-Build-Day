"""Index captured frame folders (+ per-frame meta) for the compositor → .work/manifest.json"""
import json
from pathlib import Path

root = Path(__file__).resolve().parent / ".work" / "frames"
out = {}
for d in sorted(p for p in root.iterdir() if p.is_dir()):
    n = len(list(d.glob("*.jpg")))
    m = d / "meta.json"
    tr = root.parent / "track" / f"{d.name}.json"
    out[d.name] = {"n": n, "meta": json.loads(m.read_text()) if m.exists() else None, "track": json.loads(tr.read_text()) if tr.exists() else None}
(root.parent / "manifest.json").write_text(json.dumps(out))
print({k: v["n"] for k, v in out.items()})
