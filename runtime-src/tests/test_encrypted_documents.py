"""Boundary controls for logical snapshots over immutable encrypted sources."""
from pathlib import Path
import hashlib,json,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import explorer_project_io_v2 as io
import explorer_saved_documents_v1 as sdk

class Documents(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'nested unicode-проект';self.root.mkdir()
  self.docs={'draft_meta_info.json':{'draft_id':'test','draft_materials':[]},'draft_content.json':{'tracks':[{'segments':[{'id':'clip'}]}]},'template-2.tmp':{'tracks':[{'segments':[{'id':'clip'}]}]}}
  self.plain={n:json.dumps(v).encode() for n,v in self.docs.items()}
  self.raw={n:b'encrypted-'+n.encode() for n in self.docs}
  self.write(self.raw);sdk._reader=None
 def tearDown(self):sdk._reader=None;self.temp.cleanup()
 def write(self,data):
  for n,b in data.items():(self.root/n).write_bytes(b)
 def reader(self,root,raw):
  self.assertEqual(root,self.root);self.assertEqual(raw,self.raw);return self.plain
 def test_plain_never_calls_sdk(self):
  self.write(self.plain)
  with patch.object(sdk,'decode',side_effect=AssertionError('SDK called')):self.assertEqual(io.load_project(self.root)['timeline'],self.docs['draft_content.json'])
 def test_encrypted_requires_live_owner(self):
  with self.assertRaisesRegex(ValueError,'confirmed live SDK'):io.read_documents(self.root)
 def test_snapshot_preserves_ciphertext_and_all_clips(self):
  sdk._reader=self.reader;before=io.document_hashes(self.root);dest=Path(self.temp.name)/'snapshot'
  self.assertEqual(io.snapshot_project(self.root,dest),before)
  self.assertEqual(io.load_project(dest),io.load_project(self.root));self.assertEqual(io.document_hashes(self.root),before)
  self.assertEqual(json.loads((dest/'.source-hashes.json').read_bytes()),before)
  for n,b in self.raw.items():self.assertEqual((dest/'.raw'/n).read_bytes(),b)
 def test_raw_hash_does_not_decode(self):
  with patch.object(sdk,'decode',side_effect=AssertionError()):self.assertEqual(io.document_hashes(self.root)['draft_content.json'],hashlib.sha256(self.raw['draft_content.json']).hexdigest())
 def test_corrupt_json_is_not_decrypted(self):
  (self.root/'draft_meta_info.json').write_bytes(b'{broken')
  with patch.object(sdk,'decode',side_effect=AssertionError()):
   with self.assertRaises(json.JSONDecodeError):io.read_documents(self.root)
 def test_save_race_is_rejected(self):
  def changing(root,raw):
   (root/'draft_content.json').write_bytes(b'another-revision');return self.plain
  sdk._reader=changing
  with self.assertRaises(io.SaveInProgress):io.read_documents(self.root)
 def test_nonempty_library_still_requires_store(self):
  self.docs['draft_meta_info.json']['draft_materials']=[{'value':[{'id':'media'}]}]
  sdk._reader=lambda *_:{n:json.dumps(v).encode() for n,v in self.docs.items()}
  with self.assertRaises(io.SaveInProgress):io.read_documents(self.root)
 def test_foreign_encrypted_snapshot_not_implicitly_trusted(self):
  sdk._reader=lambda root,raw:(_ for _ in ()).throw(ValueError('foreign owner'))
  with self.assertRaisesRegex(ValueError,'foreign owner'):io.load_project(self.root)
 def test_scalar_document_rejected(self):
  self.write(self.plain);(self.root/'draft_content.json').write_bytes(b'1')
  with self.assertRaisesRegex(ValueError,'must be an object'):io.read_documents(self.root)
 def test_lease_binding_clears_prior_decoder(self):
  sdk._reader=self.reader;sdk.bind({'editor':{'Status':'Unavailable'}})
  with self.assertRaisesRegex(ValueError,'confirmed live SDK'):io.read_documents(self.root)

 def bound(self,location=None):
  location=location or self.root
  return {'editor':{'Status':'Project','ProcessId':123,'ViewEpoch':7,'Project':{'Location':str(location),'DraftId':'12345678-1234-4234-8234-123456789012'}},'token':'a'*64,'statePath':str(Path(self.temp.name)/'state.json')}
 def receipt(self,data,raw=None):
  raw=raw or self.raw
  return {'status':'read','projectMutation':False,'focusUnchanged':True,'foregroundUnchanged':True,'draftId':data['editor']['Project']['DraftId'],'location':data['editor']['Project']['Location'],'documents':self.docs,'hashes':{n:hashlib.sha256(raw[n]).hexdigest() if n in raw else None for n in io.NAMES}}
 def test_bound_cache_reuses_only_identical_raw_revision(self):
  data=self.bound()
  with patch('explorer_product_bridge_v5.check_build'),patch('explorer_product_bridge_v5.invoke_observer') as native:
   native.return_value=self.receipt(data);sdk.bind(data)
   sdk.decode(self.root,self.raw);sdk.decode(self.root,self.raw);self.assertEqual(native.call_count,1)
   revised={**self.raw,'draft_content.json':b'new-cipher'};native.return_value=self.receipt(data,revised)
   sdk.decode(self.root,revised);self.assertEqual(native.call_count,2)
 def test_native_owner_and_hash_checks(self):
  data=self.bound()
  for change,error in [({'draftId':'foreign'},ValueError),({'location':str(self.root.parent)},ValueError),({'hashes':{}},io.SaveInProgress),({'projectMutation':True},ValueError),({'focusUnchanged':False},ValueError)]:
   with self.subTest(change=change),patch('explorer_product_bridge_v5.check_build'),patch('explorer_product_bridge_v5.invoke_observer',return_value={**self.receipt(data),**change}):
    sdk.bind(data)
    with self.assertRaises(error):sdk.decode(self.root,self.raw)
 def test_any_drive_is_bound_to_sdk_location_without_default_root(self):
  for drive in ['C','D','S','Z']:
   location=Path(drive+':/Editing/Клиент/Project').resolve();data=self.bound(location)
   with self.subTest(drive=drive),patch('explorer_product_bridge_v5.check_build'),patch('explorer_product_bridge_v5.invoke_observer',return_value=self.receipt(data)) as native:
    sdk.bind(data);sdk.decode(location,self.raw)
    self.assertEqual(native.call_args.args[0],123)
    lease=native.call_args.args[3].lease
    self.assertEqual(lease.viewEpoch,7);self.assertEqual(lease.token,b'a'*64)
    with self.assertRaisesRegex(ValueError,'outside active project'):sdk.decode(self.root,self.raw)

if __name__=='__main__':unittest.main()
