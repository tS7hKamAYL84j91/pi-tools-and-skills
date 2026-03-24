#!/usr/bin/env python3
import argparse
import json
import sys

def main():
    parser = argparse.ArgumentParser(description="Generate a code patch for a specific vulnerability.")
    parser.add_argument("--vulnerability-id", required=True, help="ID of the vulnerability")
    parser.add_argument("--file", required=True, help="File to patch")
    args = parser.parse_args()

    print(f"Generating patch for {args.vulnerability_id} in {args.file}...", file=sys.stderr)

    # Mock result
    patch_diff = """
--- src/db/query.py
+++ src/db/query.py
@@ -42,7 +42,7 @@
-    cursor.execute("SELECT * FROM users WHERE name = '" + user_input + "'")
+    cursor.execute("SELECT * FROM users WHERE name = %s", (user_input,))
"""

    result = {
        "vulnerability_id": args.vulnerability_id,
        "file": args.file,
        "patch": patch_diff,
        "status": "generated"
    }

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
