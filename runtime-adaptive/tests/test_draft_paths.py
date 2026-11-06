from pathlib import Path
from copy import deepcopy
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from explorer_draft_compare_v1 import same_draft
P='##_draftpath_placeholder_12345678-1234-4234-8234-123456789012_##'

class DraftPaths(unittest.TestCase):
 def test_paths_inside_nested_compositions_and_effects(self):
  for drive in ['C','D','S','Z']:
   root=drive+':/Editing/Клиент';saved={'materials':{'drafts':[{'id':'same','draft':{'materials':{'videos':[{'matting':{'path':P+'/matting\\cache'}}]}},'draft_file_path':P+'\\subdraft\\id\\draft_content.json'}],'effects':[{'color_match_info':{'source_feature_path':P+'/Resources/features/a'}}]}}
   live=deepcopy(saved);row=live['materials']['drafts'][0];row['draft']['materials']['videos'][0]['matting']['path']=root+'/matting/cache';row['draft_file_path']=root+'/subdraft/id/draft_content.json';live['materials']['effects'][0]['color_match_info']['source_feature_path']=root+'/Resources/features/a'
   self.assertTrue(same_draft(saved,live,root))
 def test_other_root_or_file_is_not_equivalent(self):
  saved={'path':P+'/Resources/a'}
  for path in ['S:/Other/Resources/a','S:/Project/Resources/b','C:/Project/Resources/a']:
   self.assertFalse(same_draft(saved,{'path':path},'S:/Project'))
 def test_traversal_ads_and_empty_components_not_normalized(self):
  for value in ['../a','Resources/../a','Resources/./a','Resources/a:stream','Resources//a','Resources/\\a','C:/a']:
   self.assertFalse(same_draft({'path':P+'/'+value},{'path':'S:/Project/a'},'S:/Project'))
 def test_subtitle_text_is_not_a_path(self):self.assertFalse(same_draft({'text':P+'/a'},{'text':'S:/Project/a'},'S:/Project'))
 def test_missing_fields_and_changed_clips_still_rejected(self):
  self.assertFalse(same_draft({'path':P+'/a','clip':1},{'path':'S:/Project/a','clip':2},'S:/Project'))
  self.assertFalse(same_draft({'path':P+'/a','clip':1},{'path':'S:/Project/a'},'S:/Project'))

if __name__=='__main__':unittest.main()
