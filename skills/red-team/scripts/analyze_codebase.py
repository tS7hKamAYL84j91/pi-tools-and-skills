#!/usr/bin/env python3
import argparse
import json
import sys

def main():
    parser = argparse.ArgumentParser(description="Simulate static analysis of a codebase for vulnerabilities.")
    parser.add_argument("--path", required=True, help="Path to the codebase")
    parser.add_argument("--rules", help="Path to custom rules file")
    args = parser.parse_args()

    print(f"Analyzing codebase at: {args.path}...", file=sys.stderr)

    # Mock result
    result = {
        "files_scanned": 150,
        "vulnerabilities": [
            {
                "id": "VULN-001",
                "type": "Hardcoded Credential",
                "file": "src/config.py",
                "line": 12,
                "severity": "High"
            },
            {
                "id": "VULN-002",
                "type": "SQL Injection",
                "file": "src/db/query.py",
                "line": 45,
                "severity": "Critical"
            }
        ]
    }

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
