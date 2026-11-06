"""Disabled helper IDs may serialize once; media IDs and clip data stay strict."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from explorer_initial_save_v1 import DEFAULTS,defaults_equivalent,normalize_first_library
from explorer_project_io_v2 import IMPLICIT_STORE

class InitialSaveTests(unittest.TestCase):
    def setUp(self):
        self.old={g:str(uuid.uuid4()) for g in DEFAULTS}
        self.new={g:str(uuid.uuid4()) for g in DEFAULTS}
        self.before={'materials':{g:[{**shape,'id':self.old[g]}] for g,shape in DEFAULTS.items()},'tracks':[{'id':'track','segments':[{'id':'clip','material_id':'media','target_timerange':{'start':0,'duration':123},'extra_material_refs':list(self.old.values())}]}]}
        self.before['materials']['videos']=[{'id':'media','path':'C:/source.png'}]
        self.after=deepcopy(self.before)
        for g in DEFAULTS:self.after['materials'][g][0]['id']=self.new[g]
        self.after['tracks'][0]['segments'][0]['extra_material_refs']=list(self.new.values())

    def test_defaults_with_same_clip_references_are_equivalent(self):self.assertTrue(defaults_equivalent(self.before,self.after))
    def test_changed_timing_rejected(self):
        self.after['tracks'][0]['segments'][0]['target_timerange']['start']+=1
        self.assertFalse(defaults_equivalent(self.before,self.after))
    def test_changed_media_identity_rejected(self):
        self.after['materials']['videos'][0]['id']='another-media'
        self.assertFalse(defaults_equivalent(self.before,self.after))
    def test_changed_source_path_rejected(self):
        self.after['materials']['videos'][0]['path']='C:/another.png'
        self.assertFalse(defaults_equivalent(self.before,self.after))
    def test_enabled_processing_rejected(self):
        self.before['materials']['loudnesses'][0]['enable']=True
        self.after['materials']['loudnesses'][0]['enable']=True
        self.assertFalse(defaults_equivalent(self.before,self.after))
    def test_different_parameters_rejected(self):
        self.after['materials']['vocal_separations'][0]['choice']=1
        self.assertFalse(defaults_equivalent(self.before,self.after))
    def test_ambiguous_reference_rejected(self):
        self.after['tracks'][0]['segments'][0]['extra_material_refs'].reverse()
        self.assertFalse(defaults_equivalent(self.before,self.after))
    def test_nonempty_library_is_never_normalized(self):
        before={'meta':{'draft_materials':[{'type':0,'value':[{'id':'existing'}]}]},'store':deepcopy(IMPLICIT_STORE),'timeline':self.before}
        after=deepcopy(before);after['timeline']=self.after
        self.assertEqual(normalize_first_library(before,after),before)

if __name__=='__main__':unittest.main()
