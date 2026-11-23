import importlib.util
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('r98_export',ROOT/'scripts/export_pure_source_zip.py')
exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)
class ExportSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'repo';self.root.mkdir();(self.root/'package.json').write_text('{}')
        (self.root/'src').mkdir();(self.root/'src/main.ts').write_text('export const n = 1;\n')
        self.output=Path(self.temp.name)/'source.zip'
    def run_export(self,**kwargs):return exporter.export(self.root,self.output,'R98',**kwargs)
    def test_keeps_lockfile_handoff_and_hashed_source(self):
        (self.root/'package-lock.json').write_text('{}');(self.root/'REVIEW_HANDOFF.json').write_text('{"verified":false}')
        result=self.run_export();self.assertTrue(result['has_dependency_lockfile']);self.assertTrue(result['has_handoff'])
        with zipfile.ZipFile(self.output) as z:
            manifest=json.loads(z.read('horse-registry-src/EXPORT_MANIFEST.json'))
            for item in manifest['files']:
                self.assertEqual(exporter.hashlib.sha256(z.read('horse-registry-src/'+item['path'])).hexdigest(),item['sha256'])
            self.assertIn('NO claim',z.read('horse-registry-src/PACKAGE-INFO.txt').decode())
    def test_omits_binary_assets_and_private_environment(self):
        (self.root/'src/x.png').write_bytes(b'\xff\x00');(self.root/'src/.env').write_text('PRIVATE=yes')
        (self.root/'src/explanation.md').write_text('long report');self.run_export()
        with zipfile.ZipFile(self.output) as z:
            names=z.namelist()
            self.assertFalse(any(n.endswith(('.png','.env')) for n in names))
            # R102 comprehensive scope: documentation (.md) is INCLUDED now;
            # only binaries, secrets and residue stay out.
            self.assertIn('horse-registry-src/src/explanation.md',names)

    def test_required_source_data_directories_survive_without_exporting_database_data(self):
        nested=self.root/'src/web/frontends/retro-astra/transplant/data'
        nested.mkdir(parents=True)
        (nested/'horses.ts').write_text('export interface Horse { id: number }\n')
        private=self.root/'data/exports'
        private.mkdir(parents=True)
        (private/'registry.json').write_text('{"private":true}')
        (private/'snapshot.sql').write_text('INSERT INTO users VALUES (1);')
        for pin in ('.nvmrc', '.node-version'):
            (self.root/pin).write_text('24.19.0\n')
        self.run_export()
        with zipfile.ZipFile(self.output) as z:
            names=z.namelist()
            self.assertIn('horse-registry-src/src/web/frontends/retro-astra/transplant/data/horses.ts',names)
            self.assertFalse(any(n.startswith('horse-registry-src/data/') for n in names))
            self.assertIn('horse-registry-src/.nvmrc',names)
            self.assertIn('horse-registry-src/.node-version',names)
    def test_refuses_to_clobber_existing_output(self):
        self.output.write_text('keep');
        with self.assertRaises(FileExistsError):self.run_export()
        self.assertEqual(self.output.read_text(),'keep')
    def test_explicit_overwrite_is_atomic(self):
        self.output.write_text('old');self.run_export(overwrite=True);self.assertTrue(zipfile.is_zipfile(self.output))
    def test_secret_detection_redacts_without_publishing(self):
        # R144/R145 standing policy (owner directive): the repo keeps the
        # credential-recovery documentation, but Master-AI zips REDACT the
        # documented token formats instead of failing the whole export.
        token='ghp_'+'a'*30
        (self.root/'src/leak.ts').write_text('const token="'+token+'";')
        self.run_export()
        with zipfile.ZipFile(self.output) as z:
            names=z.namelist()
            self.assertIn('horse-registry-src/src/leak.ts',names)
            body=z.read('horse-registry-src/src/leak.ts').decode('utf-8')
            self.assertNotIn(token,body)
            self.assertIn('REDACTED',body)
    def test_symlink_cannot_escape_source_root(self):
        external=Path(self.temp.name)/'external.ts';external.write_text('not exportable')
        (self.root/'src/escape.ts').symlink_to(external)
        with self.assertRaisesRegex(ValueError,'Symlink'):self.run_export()
    def test_unknown_binary_is_not_silently_packaged(self):
        # Extensionless: an unknown binary format must fail loudly rather than
        # be silently dropped (known binary suffixes are excluded by policy).
        (self.root/'src/data').write_bytes(b'\xff\x00')
        with self.assertRaisesRegex(ValueError,'Non-text'):self.run_export()
    def test_invalid_round_refused(self):
        with self.assertRaises(ValueError):exporter.export(self.root,self.output,'../R98')
    def test_available_inputs_produce_deterministic_archive(self):
        first=self.run_export();second=self.run_export(overwrite=True);self.assertEqual(first['sha256'],second['sha256'])
    def test_existing_output_symlink_refused(self):
        target=Path(self.temp.name)/'target';target.write_text('retain');self.output.symlink_to(target)
        with self.assertRaisesRegex(ValueError,'symlink'):self.run_export(overwrite=True)
        self.assertEqual(target.read_text(),'retain')
    def test_tracked_only_enumeration_blocks_untracked_leak(self):
        # R101 shipped a stray untracked 'Name' file; tracked-only enumeration
        # must keep untracked junk out while still shipping tracked docs.
        (self.root/'README.md').write_text('# demo documentation')
        subprocess.run(['git','init','-q'],cwd=self.root,check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['git','add','-A','--','.',':(exclude)Name'],cwd=self.root,check=True)
        (self.root/'Name').write_text('stray untracked junk')
        self.run_export()
        with zipfile.ZipFile(self.output) as z:
            names=z.namelist()
            self.assertNotIn('horse-registry-src/Name',names)
            self.assertIn('horse-registry-src/README.md',names)
            self.assertIn('horse-registry-src/src/main.ts',names)
    def test_round_workspaces_auto_included_except_retired_residue(self):
        # R103 gap: review-r102 was missed because SOURCE_DIRS hardcoded
        # review-r98. Any tracked review-r<number>/ dir must now ship
        # automatically, while the retired residue rounds stay excluded.
        for d in ('review-r98','review-r102','review-r103','review-r96','review-r97'):
            (self.root/d).mkdir(parents=True);(self.root/d/'PLAN.md').write_text('# plan '+d)
        (self.root/'review-r102/evidence/shot.png').parent.mkdir(parents=True,exist_ok=True)
        (self.root/'review-r102/evidence/shot.png').write_bytes(b'\xff\xd8\xff')
        (self.root/'review-r102/evidence/run.json').write_text('{"ok":true}')
        self.run_export()
        with zipfile.ZipFile(self.output) as z:
            names=z.namelist()
            for d in ('review-r98','review-r102'):
                self.assertIn('horse-registry-src/'+d+'/PLAN.md',names)
            # future/unknown rounds: covered by the same regex, no exporter edit needed
            self.assertIn('horse-registry-src/review-r103/PLAN.md',names)
            # retired residue rounds stay out
            for d in ('review-r96','review-r97'):
                self.assertNotIn('horse-registry-src/'+d+'/PLAN.md',names)
            # binary evidence assets still excluded, text evidence shipped
            self.assertNotIn('horse-registry-src/review-r102/evidence/shot.png',names)
            self.assertIn('horse-registry-src/review-r102/evidence/run.json',names)

    def test_all_round_configs_and_current_handoff_are_retained(self):
        (self.root/'package.json').write_text(json.dumps({'scripts': {'check': 'tsc -p tsconfig.r109-core.json'}}))
        for name in ('tsconfig.r109-core.json', 'tsconfig.future.ui.json', 'REVIEW_CURRENT.json'):
            (self.root/name).write_text('{}')
        (self.root/'R109_START_HERE.md').write_text('# current review')
        self.run_export()
        with zipfile.ZipFile(self.output) as z:
            for name in ('tsconfig.r109-core.json', 'tsconfig.future.ui.json', 'REVIEW_CURRENT.json', 'R109_START_HERE.md'):
                self.assertIn('horse-registry-src/'+name, z.namelist())

    def test_missing_script_config_fails_before_publishing(self):
        for command in ('tsc -p tsconfig.missing.json', 'tsc --project=tsconfig.missing.json', 'tsc --noEmit -p "tsconfig.missing.json"'):
            (self.root/'package.json').write_text(json.dumps({'scripts': {'gate': command}}))
            with self.assertRaisesRegex(ValueError, 'missing or unexported'):
                self.run_export()
            self.assertFalse(self.output.exists())

    def test_untracked_required_config_does_not_silently_disappear(self):
        (self.root/'package.json').write_text(json.dumps({'scripts': {'gate': 'tsc -p tsconfig.local.json'}}))
        subprocess.run(['git','init','-q'],cwd=self.root,check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['git','add','package.json','src'],cwd=self.root,check=True)
        (self.root/'tsconfig.local.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'missing or unexported'):
            self.run_export()
