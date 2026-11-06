from pathlib import Path
from copy import deepcopy
import sys,unittest,uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from explorer_compound_alias_v1 import equivalent

class CompoundAlias(unittest.TestCase):
 def setUp(self):
  self.before={'materials':{'drafts':[{'id':'stable-material','type':'combination','combination_id':str(uuid.uuid4()),'draft':{'id':'stable-draft','materials':{},'tracks':[{'segments':[{'id':'stable-clip','material_id':'source','duration':30}]}]}}]},'tracks':[{'segments':[{'material_id':'stable-material'}]}]}
  self.after=deepcopy(self.before);self.after['materials']['drafts'][0]['combination_id']=str(uuid.uuid4())
 def test_only_standalone_alias_may_refresh(self):self.assertTrue(equivalent(self.before,self.after))
 def test_complete_embedded_draft_is_preserved(self):
  self.after['materials']['drafts'][0]['draft']['tracks'][0]['segments'][0]['duration']=31;self.assertFalse(equivalent(self.before,self.after))
 def test_material_and_draft_ids_are_not_aliases(self):
  for path in ['id','draft']:
   after=deepcopy(self.after)
   if path=='id':after['materials']['drafts'][0]['id']='other'
   else:after['materials']['drafts'][0]['draft']['id']='other'
   self.assertFalse(equivalent(self.before,after))
 def test_referenced_alias_is_not_normalized(self):
  self.before['ref']=self.before['materials']['drafts'][0]['combination_id'];self.after['ref']=self.after['materials']['drafts'][0]['combination_id'];self.assertFalse(equivalent(self.before,self.after))
 def test_added_or_removed_composition_rejected(self):
  self.after['materials']['drafts'].append(deepcopy(self.after['materials']['drafts'][0]));self.assertFalse(equivalent(self.before,self.after))
 def test_parent_clip_change_rejected(self):
  self.after['tracks'][0]['segments'][0]['material_id']='other';self.assertFalse(equivalent(self.before,self.after))
 def test_bad_or_reused_uuid_rejected(self):
  self.after['materials']['drafts'][0]['combination_id']='bad';self.assertFalse(equivalent(self.before,self.after))
 def test_other_row_fields_preserved(self):
  self.after['materials']['drafts'][0]['name']='new';self.assertFalse(equivalent(self.before,self.after))

if __name__=='__main__':unittest.main()
