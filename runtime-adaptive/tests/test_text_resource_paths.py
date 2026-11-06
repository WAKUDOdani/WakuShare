import json,sys,unittest
from pathlib import Path
from copy import deepcopy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from explorer_draft_compare_v1 import same_draft
class TextResourcePaths(unittest.TestCase):
 def setUp(self):
  self.root='C:/Projects/One'
  self.path='##_draftpath_placeholder_11111111-1111-4111-8111-111111111111_##/Resources/font.ttf'
  self.style={'text':'keep this text','styles':[{'font':{'path':self.path},'range':[0,14],'size':13}]}
  self.before={'materials':{'texts':[{'content':json.dumps(self.style)}]}}
 def changed(self,**values):
  style=deepcopy(self.style);style['styles'][0]['font']['path']=self.root+'/Resources/font.ttf';style.update(values)
  return {'materials':{'texts':[{'content':json.dumps(style)}]}}
 def test_only_equivalent_nested_font_resource_is_accepted(self):self.assertTrue(same_draft(self.before,self.changed(),self.root))
 def test_changed_text_is_rejected(self):self.assertFalse(same_draft(self.before,self.changed(text='changed'),self.root))
 def test_different_font_is_rejected(self):
  after=self.changed();after['materials']['texts'][0]['content']=after['materials']['texts'][0]['content'].replace('font.ttf','other.ttf');self.assertFalse(same_draft(self.before,after,self.root))
 def test_changed_style_is_rejected(self):
  after=self.changed();style=json.loads(after['materials']['texts'][0]['content']);style['styles'][0]['size']=14;after['materials']['texts'][0]['content']=json.dumps(style);self.assertFalse(same_draft(self.before,after,self.root))
 def test_duplicate_content_fields_are_rejected(self):
  after=self.changed();after['materials']['texts'][0]['content']='{"text":"hidden","text":"keep this text","styles":[]}';self.assertFalse(same_draft(self.before,after,self.root))
