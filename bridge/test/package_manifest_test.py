"""Check ChatGPT-specific required metadata beyond the portable schema."""
import importlib.util
import json
import pathlib
import shutil
import tempfile
import unittest

SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/package-plugin.py'
spec=importlib.util.spec_from_file_location('package_plugin',SCRIPT)
package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)

class ManifestTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory(prefix='bridge-manifest-');self.addCleanup(temp.cleanup)
        self.root=pathlib.Path(temp.name)/'plugin'
        shutil.copytree(package.REPO/'plugin',self.root)
    def write(self,data):
        (self.root/'plugin.json').write_text(json.dumps(data))
    def data(self):
        return json.loads((self.root/'plugin.json').read_text())
    def test_current_manifest_is_import_ready(self):
        self.assertEqual(package.manifest(self.root)['name'],'desktop-bridge-p111')
    def test_missing_author_fails_before_packaging(self):
        data=self.data();data.pop('author');self.write(data)
        with self.assertRaisesRegex(AssertionError,'author.name'):package.manifest(self.root)
    def test_missing_developer_name_fails_before_packaging(self):
        data=self.data();data['extensions']['com.openai']['interface'].pop('developerName');self.write(data)
        with self.assertRaisesRegex(AssertionError,'developerName'):package.manifest(self.root)

if __name__=='__main__':unittest.main()
