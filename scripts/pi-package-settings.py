#!/usr/bin/env python3
"""Register or remove this repo's pi package settings."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

PACKAGE_EXTENSIONS = [
    "extensions/pi-panopticon/**",
    "extensions/pi-goal/**",
]

USER_INSTALLABLE_PACKAGES = {
    "pi-goal",
    "pi-matrix",
    "pi-teams",
    "pi-ollama-models",
    "pi-panopticon",
}

PROJECT_ONLY_PACKAGES = {
    "pi-coas",
    "pi-file-watch",
    "pi-kanban",
}

OWNED_EXTENSION_DIRS = [
    "pi-panopticon",
    "pi-teams",
    "council",
    "pi-file-watch",
    "pi-kanban",
    "pi-matrix",
    "pi-coas",
    "pi-goal",
    "pi-ollama-models",
]


def legacy_path(path: str) -> str:
    return path.replace("/pi-tools-and-skills/", "/tools-and-skills/")


def legacy_package_dir(package_dir: str) -> str:
    return package_dir.replace("/pi-tools-and-skills", "/tools-and-skills")


def load_settings(settings_path: str) -> dict[str, Any]:
    if not os.path.exists(settings_path):
        return {}
    # nosemgrep: tspi-path-traversal-python -- setup-pi supplies this trusted local settings path.
    with open(settings_path, "r") as handle:
        loaded = json.load(handle)
    return loaded if isinstance(loaded, dict) else {}


def save_settings(settings_path: str, settings: dict[str, Any]) -> None:
    # nosemgrep: tspi-path-traversal-python -- setup-pi supplies this trusted local settings path.
    with open(settings_path, "w") as handle:
        json.dump(settings, handle, indent=2)
        handle.write("\n")


def set_or_delete_list(settings: dict[str, Any], key: str, values: list[Any]) -> None:
    if values:
        settings[key] = values
    else:
        settings.pop(key, None)


def remove_listed(settings: dict[str, Any], key: str, values: set[str]) -> int:
    existing = settings.get(key, [])
    if not isinstance(existing, list):
        return 0
    filtered = [item for item in existing if item not in values]
    set_or_delete_list(settings, key, filtered)
    return len(existing) - len(filtered)


def ensure_listed(settings: dict[str, Any], key: str, value: str) -> None:
    existing = settings.get(key, [])
    if not isinstance(existing, list):
        existing = []
    old_value = legacy_path(value)
    filtered = [item for item in existing if item != old_value]
    if value not in filtered:
        filtered.append(value)
    settings[key] = filtered


def package_sources(package_dir: str) -> set[str]:
    return {package_dir, legacy_package_dir(package_dir)}


def remove_owned_package_entries(settings: dict[str, Any], package_dir: str) -> int:
    existing = settings.get("packages", [])
    if not isinstance(existing, list):
        return 0
    sources = package_sources(package_dir)
    filtered = []
    removed = 0
    for entry in existing:
        source = entry.get("source") if isinstance(entry, dict) else entry
        if source in sources:
            removed += 1
            continue
        filtered.append(entry)
    set_or_delete_list(settings, "packages", filtered)
    return removed


def owned_extension_paths(ext_dir: str) -> set[str]:
    legacy_ext_dir = legacy_path(ext_dir)
    paths = {ext_dir, legacy_ext_dir}
    for name in OWNED_EXTENSION_DIRS:
        paths.add(os.path.join(ext_dir, name))
        paths.add(os.path.join(legacy_ext_dir, name))
    return paths


def ensure_package_entry(settings: dict[str, Any], source: str, extensions: list[str] | None = None) -> None:
    settings.setdefault("packages", [])
    if not isinstance(settings["packages"], list):
        settings["packages"] = []
    sources = package_sources(source)
    settings["packages"] = [
        entry
        for entry in settings["packages"]
        if (entry.get("source") if isinstance(entry, dict) else entry) not in sources
    ]
    entry: dict[str, Any] = {"source": source}
    if extensions is not None:
        entry["extensions"] = extensions
    settings["packages"].append(entry)


def package_path(package_dir: str, package_name: str) -> str:
    if package_name in PROJECT_ONLY_PACKAGES:
        raise ValueError(f"{package_name} is project-specific and must be enabled per workspace, not globally")
    if package_name not in USER_INSTALLABLE_PACKAGES:
        allowed = ", ".join(sorted(USER_INSTALLABLE_PACKAGES))
        raise ValueError(f"Unknown or non-user-installable package: {package_name}. Allowed: {allowed}")
    return os.path.join(package_dir, "extensions", package_name)


def register(args: list[str]) -> None:
    settings_path, package_dir, skills_dir, ext_dir, prompts_dir = args
    settings = load_settings(settings_path)

    remove_owned_package_entries(settings, package_dir)
    ensure_package_entry(settings, package_dir, PACKAGE_EXTENSIONS)

    remove_listed(settings, "skills", {skills_dir, legacy_path(skills_dir)})
    remove_listed(settings, "prompts", {prompts_dir, legacy_path(prompts_dir)})
    remove_listed(settings, "extensions", owned_extension_paths(ext_dir))
    save_settings(settings_path, settings)


def register_package(args: list[str]) -> None:
    settings_path, package_dir, _skills_dir, ext_dir, _prompts_dir, package_name = args
    settings = load_settings(settings_path)
    source = package_path(package_dir, package_name)
    remove_listed(settings, "extensions", {source, legacy_path(source)})
    remove_listed(settings, "extensions", {os.path.join(ext_dir, package_name), legacy_path(os.path.join(ext_dir, package_name))})
    ensure_package_entry(settings, source)
    save_settings(settings_path, settings)


def clean(args: list[str]) -> None:
    settings_path, package_dir, skills_dir, ext_dir, prompts_dir = args
    settings = load_settings(settings_path)

    removed_packages = remove_owned_package_entries(settings, package_dir)
    remove_listed(settings, "skills", {skills_dir, legacy_path(skills_dir)})
    remove_listed(settings, "prompts", {prompts_dir, legacy_path(prompts_dir)})
    remove_listed(settings, "extensions", owned_extension_paths(ext_dir))
    save_settings(settings_path, settings)
    print(f"  Removed packages: {removed_packages}")


def clean_package(args: list[str]) -> None:
    settings_path, package_dir, _skills_dir, _ext_dir, _prompts_dir, package_name = args
    settings = load_settings(settings_path)
    source = package_path(package_dir, package_name)
    removed_packages = remove_owned_package_entries(settings, source)
    save_settings(settings_path, settings)
    print(f"  Removed packages: {removed_packages}")


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action in {"register", "clean"} and len(sys.argv) == 7:
        args = sys.argv[2:]
        if action == "register":
            register(args)
        else:
            clean(args)
        return 0
    if action in {"register-package", "clean-package"} and len(sys.argv) == 8:
        args = sys.argv[2:]
        try:
            if action == "register-package":
                register_package(args)
            else:
                clean_package(args)
        except ValueError as error:
            print(f"Error: {error}", file=sys.stderr)
            return 1
        return 0
    print(
        "Usage: pi-package-settings.py register|clean SETTINGS PACKAGE SKILLS EXTENSIONS PROMPTS\n"
        "       pi-package-settings.py register-package|clean-package SETTINGS PACKAGE SKILLS EXTENSIONS PROMPTS NAME",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
