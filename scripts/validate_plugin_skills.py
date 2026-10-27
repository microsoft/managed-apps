"""Validate every packaged skill with the pinned Agent Skills reference library."""

import sys
from pathlib import Path

from skills_ref.errors import ParseError
from skills_ref.parser import parse_frontmatter
from skills_ref.validator import validate_metadata


def validate_skills(plugin: Path) -> list[str]:
    errors = []
    skills = sorted(path for path in (plugin / "skills").iterdir() if path.is_dir())
    if not skills:
        return ["skills: at least one packaged skill is required"]
    for skill in skills:
        file = skill / "SKILL.md"
        if not file.is_file():
            errors.append(f"{skill.name}: missing SKILL.md")
            continue
        try:
            metadata, _ = parse_frontmatter(file.read_text(encoding="utf-8"))
        except ParseError as error:
            errors.append(f"{skill.name}: {error}")
            continue
        skill_errors = validate_metadata(metadata, skill)
        for error in skill_errors:
            errors.append(f"{skill.name}: {error}")
        if skill_errors:
            continue
        # The reference library does not check types for every optional field.
        for field in ("license", "allowed-tools"):
            if field in metadata and not isinstance(metadata[field], str):
                errors.append(f"{skill.name}: {field} must be a string")
        if "metadata" in metadata:
            value = metadata["metadata"]
            if not isinstance(value, dict) or not all(
                isinstance(key, str) and isinstance(item, str) for key, item in value.items()
            ):
                errors.append(f"{skill.name}: metadata must map strings to strings")
        if "compatibility" in metadata and not metadata["compatibility"].strip():
            errors.append(f"{skill.name}: compatibility must not be empty")
    return errors


if __name__ == "__main__":
    plugin = Path(__file__).resolve().parents[1] / "plugins" / "microsoft-managed-apps"
    errors = validate_skills(plugin)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print("All packaged skills conform to the Agent Skills specification.")
