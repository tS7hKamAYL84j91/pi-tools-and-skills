# Red Team Vulnerability Planner Skill

## Overview
This directory contains the **Red Team Agentic Skill**, a comprehensive definition of capability for an autonomous agent to perform security assessments. This skill is built based on the research report: *"Architecting the Autonomous Red Team: A Comprehensive Research Report on Agentic Skills for Vulnerability Identification and Mitigation"*.

The skill is defined in `SKILL.md` and includes a set of mock tools in `tools/` to simulate the execution of security tasks.

## Contents

- **`SKILL.md`**: The core skill definition file. It contains the YAML frontmatter (metadata) and the cognitive script (Markdown body) that guides the agent's reasoning and actions.
- **`tools/`**: A directory containing Python scripts that act as wrappers or mocks for security tools.
    - `scan_network.py`: Simulates network scanning (e.g., Nmap).
    - `analyze_codebase.py`: Simulates static code analysis (SAST).
    - `query_threat_intel.py`: Queries threat intelligence sources (e.g., MITRE ATLAS).
    - `simulate_prompt_injection.py`: Tests LLM endpoints for prompt injection vulnerabilities.
    - `generate_patch.py`: Generates code patches for identified vulnerabilities.

## Usage

This skill is designed to be ingested by an agentic framework (such as the one described in the "Hive-Mind" substrate or "Manis Planning" system). The agent parses the `SKILL.md` file to understand its persona, objectives, and allowed actions.

### Operational Protocol
The agent operates in loops:
1.  **Observe (Reconnaissance)**: Enumerating tools and analyzing memory persistence.
2.  **Decide (Exploitation Simulation)**: Mapping observations to threat frameworks and planning safe proofs-of-concept.
3.  **Act (Mitigation Planning)**: Generating remediation strategies and patches.

## Safety Policy
The skill enforces a **strict non-destructive** safety policy. The agent is explicitly instructed not to perform actions that could damage data or disrupt services. All external inputs are treated as potentially malicious to prevent indirect prompt injection.

## References
- **MITRE ATLAS Framework**: October 2025 Update (specifically AML.T0086 and AML.T0085).
- **OWASP Agentic AI Threat Model**: Focus on Excessive Agency and Indirect Prompt Injection.
- **AutoRedTeamer & Incalmo**: Frameworks for strategic diversity and action planning.
