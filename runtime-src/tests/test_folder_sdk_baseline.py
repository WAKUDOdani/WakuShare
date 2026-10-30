from pathlib import Path
from copy import deepcopy
import sys,tempfile,json,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from explorer_folder_sdk_baseline_v1 import baseline,saved_state,template_exact

class SdkBaseline(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.sidecar=self.root/'sdk-before.json'
  self.saved={'meta':{'draft_materials':[]},'store':{},'timeline':{'id':'timeline','tracks':[{'segments':[{'id':'clip','text':'old saved value'}]}]}}
  self.sdk=deepcopy(self.saved['timeline']);self.sdk['tracks'][0]['segments'][0]['text']='actual editor value'
  self.sidecar.write_text(json.dumps(self.sdk),encoding='utf8')
  self.proof={k:True for k in ('completeSdkBaseline','sdkBinUnchanged','allSdkDraftsUnchanged','focusUnchanged','foregroundUnchanged','navigationUnchanged')}
 def tearDown(self):self.temp.cleanup()
 def test_complete_sdk_preimage_keeps_current_unsaved_edits(self):
  result,expected=baseline(self.saved,self.proof,self.sidecar);self.assertEqual(expected,self.sdk);self.assertEqual(result['timeline'],self.sdk);self.assertNotEqual(self.saved['timeline'],self.sdk)
 def test_partial_native_proof_rejected(self):
  for key in self.proof:
   if key=='completeSdkBaseline':continue
   with self.subTest(key=key),self.assertRaises(ValueError):baseline(self.saved,{**self.proof,key:False},self.sidecar)
 def test_foreign_timeline_rejected(self):
  self.sdk['id']='other';self.sidecar.write_text(json.dumps(self.sdk))
  with self.assertRaises(ValueError):baseline(self.saved,self.proof,self.sidecar)
 def test_subsequent_actual_edit_is_not_normalized(self):
  after=deepcopy(self.saved);after['timeline']=deepcopy(self.sdk);after['timeline']['tracks'][0]['segments'][0]['text']='changed during command'
  self.assertNotEqual(saved_state(after,self.sdk,self.root)['timeline'],self.sdk)
 def test_saved_complete_template_must_match_sdk(self):
  (self.root/'draft_meta_info.json').write_text(json.dumps(self.saved['meta']));(self.root/'draft_content.json').write_text(json.dumps(self.sdk));(self.root/'template-2.tmp').write_text(json.dumps(self.sdk))
  self.assertTrue(template_exact(self.root,self.sdk,self.root));self.sdk['tracks'][0]['segments'][0]['text']='different';self.assertFalse(template_exact(self.root,self.sdk,self.root))
 def test_read_only_completion_keeps_other_metadata_strict(self):
  from explorer_folder_completion_v1 import compare
  before=deepcopy(self.saved);after=deepcopy(self.saved);before['meta']['other']='old';after['meta']['other']='changed'
  with patch('explorer_folder_completion_v1.compare_folder',return_value={'errors':[]}),patch('explorer_folder_sdk_baseline_v1.template_exact',return_value=True):
   result=compare(before,after,{},self.root,self.root,self.sdk,self.root)
  self.assertFalse(result['accepted']);self.assertIn('Other metadata changed',result['errors'])

if __name__=='__main__':unittest.main()
