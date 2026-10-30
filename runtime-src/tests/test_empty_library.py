"""Empty library and populated timeline regressions, no native/editor calls."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from explorer_project_io_v2 import _read_documents,load_project,snapshot_project,IMPLICIT_STORE
from explorer_project_io import SaveInProgress
from explorer_folder_completion_v1 import compare

class EmptyLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='wakushare-empty-library-')
        self.directory=Path(self.temporary.name)/'project';self.directory.mkdir()
        self.meta={'draft_materials':[{'type':0,'value':[]},{'type':18,'value':[]}]}
        self.timeline={'id':'timeline','tracks':[{'id':'text-track','type':'text','segments':[{'id':'title','material_id':'text','target_timerange':{'start':0,'duration':1000000}}]}]}
        self.write()

    def tearDown(self):self.temporary.cleanup()

    def write(self):
        (self.directory/'draft_meta_info.json').write_text(json.dumps(self.meta),encoding='utf8')
        (self.directory/'draft_content.json').write_text(json.dumps(self.timeline),encoding='utf8')
        (self.directory/'template-2.tmp').write_text(json.dumps(self.timeline),encoding='utf8')

    def test_populated_timeline_does_not_require_a_serialized_library(self):
        before={p.name:p.read_bytes() for p in self.directory.iterdir()}
        loaded=load_project(self.directory)
        self.assertEqual(loaded['store'],IMPLICIT_STORE)
        self.assertEqual(loaded['timeline'],self.timeline)
        self.assertEqual(before,{p.name:p.read_bytes() for p in self.directory.iterdir()})

    def test_snapshot_preserves_all_clips_and_absence(self):
        snapshot=Path(self.temporary.name)/'snapshot'
        hashes=snapshot_project(self.directory,snapshot)
        self.assertIsNone(hashes['draft_virtual_store.json'])
        self.assertFalse((snapshot/'draft_virtual_store.json').exists())
        self.assertEqual(load_project(snapshot),load_project(self.directory))

    def test_nonempty_registry_still_requires_a_tree(self):
        for group in self.meta['draft_materials']:
            group['value']=[{'id':'existing-card','file_Path':'C:/existing.mp4'}]
            self.write()
            with self.assertRaises(SaveInProgress):_read_documents(self.directory)
            group['value']=[]

    def test_malformed_existing_tree_is_not_an_implicit_tree(self):
        (self.directory/'draft_virtual_store.json').write_text('{',encoding='utf8')
        with self.assertRaises(json.JSONDecodeError):_read_documents(self.directory)

    def test_missing_mandatory_document_still_waits(self):
        (self.directory/'draft_content.json').unlink()
        with self.assertRaises(SaveInProgress):_read_documents(self.directory)

    def test_first_folder_comparison_preserves_text_clips(self):
        before=load_project(self.directory);after=deepcopy(before)
        job={'FolderId':'new-folder','Name':'Media','ParentFolderId':''}
        after['store']['draft_virtual_store'][0]['value'].append({'id':'new-folder','display_name':'Media'})
        after['store']['draft_virtual_store'][1]['value'].append({'child_id':'new-folder','parent_id':''})
        self.assertTrue(compare(before,after,job,self.directory,self.directory)['accepted'])
        changed=deepcopy(after);changed['timeline']['tracks'][0]['segments'][0]['target_timerange']['duration']+=1
        self.assertFalse(compare(before,changed,job,self.directory,self.directory)['accepted'])
        changed=deepcopy(after);changed['store']['draft_virtual_store'][1]['value'].append({'child_id':'new-folder','parent_id':''})
        self.assertFalse(compare(before,changed,job,self.directory,self.directory)['accepted'])

if __name__=='__main__':unittest.main()
