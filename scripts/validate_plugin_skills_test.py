import tempfile
import unittest
from pathlib import Path

from validate_plugin_skills import validate_skills


class SkillValidationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.plugin = Path(self.directory.name)
        self.skill = self.plugin / "skills" / "example"
        self.skill.mkdir(parents=True)

    def write_skill(self, extra="", name="example", description="Example skill."):
        (self.skill / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {description}\n{extra}---\nInstructions.\n",
            encoding="utf-8",
        )

    def test_valid_portable_skill(self):
        self.write_skill('allowed-tools: Read Edit\nmetadata:\n  author: Microsoft\n')
        self.assertEqual(validate_skills(self.plugin), [])

    def test_invalid_skills(self):
        for extra, name, description in [
            ("model: opus\n", "example", "Example."),
            ("user-invocable: true\n", "example", "Example."),
            ("", "different-name", "Example."),
            ("", "example", "x" * 1025),
            ('compatibility: ""\n', "example", "Example."),
            ("metadata: invalid\n", "example", "Example."),
            ("allowed-tools: [Read, Edit]\n", "example", "Example."),
        ]:
            with self.subTest(extra=extra, name=name):
                self.write_skill(extra, name, description)
                self.assertTrue(validate_skills(self.plugin))

    def test_missing_and_malformed_frontmatter(self):
        for content in ["Instructions.", "---\nname: [\n---\nInstructions."]:
            with self.subTest(content=content):
                (self.skill / "SKILL.md").write_text(content, encoding="utf-8")
                self.assertTrue(validate_skills(self.plugin))

    def test_checks_every_immediate_skill(self):
        self.write_skill()
        (self.plugin / "skills" / "missing").mkdir()
        self.assertTrue(validate_skills(self.plugin))

    def test_empty_package(self):
        self.skill.rmdir()
        self.assertTrue(validate_skills(self.plugin))


if __name__ == "__main__":
    unittest.main()
