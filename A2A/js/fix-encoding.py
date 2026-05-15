"""
fix-encoding.py
Converts all UTF-16 LE .ts files in src/ back to UTF-8 (no BOM).
Run once from the js/ folder: python fix-encoding.py
"""
import os
import sys

src_root = os.path.join(os.path.dirname(__file__), "src")

fixed = []
skipped = []
errors = []

for dirpath, dirnames, filenames in os.walk(src_root):
    for fname in filenames:
        if not fname.endswith(".ts"):
            continue
        fpath = os.path.join(dirpath, fname)
        try:
            with open(fpath, "rb") as f:
                raw = f.read()

            # Detect UTF-16 LE BOM (FF FE) or UTF-16 BE BOM (FE FF)
            if raw[:2] == b'\xff\xfe':
                text = raw.decode("utf-16-le").lstrip('\ufeff')
            elif raw[:2] == b'\xfe\xff':
                text = raw.decode("utf-16-be").lstrip('\ufeff')
            else:
                # Try to detect UTF-16 without BOM by checking null byte pattern
                # UTF-16 LE ASCII files have 0x00 as every second byte
                if len(raw) > 2 and raw[1] == 0 and raw[3] == 0:
                    text = raw.decode("utf-16-le")
                else:
                    skipped.append(fpath)
                    continue

            with open(fpath, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            fixed.append(fpath)
            print(f"  FIXED  {os.path.relpath(fpath, os.path.dirname(__file__))}")

        except Exception as e:
            errors.append((fpath, str(e)))
            print(f"  ERROR  {fpath}: {e}")

print(f"\nDone: {len(fixed)} fixed, {len(skipped)} already UTF-8, {len(errors)} errors.")
