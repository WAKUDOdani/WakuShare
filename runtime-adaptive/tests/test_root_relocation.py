"""Root repair must never become filename-based automatic source substitution."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import explorer_root_relocation_v1 as repair

class RootRepairTests(unittest.TestCase):
    def test_only_paths_change_across_every_loaded_timeline(self):
        drafts={name:{'id':name,'materials':{'videos':[{'id':'source','path':'C:/Media/one.png','name':'My custom name','crop':{'x':1}}]},'tracks':[{'segments':[{'id':'clip','material_id':'source','start':123}]}]} for name in ('main','other')}
        before=deepcopy(drafts)
        result=repair.relocated_drafts(drafts,[{'old':'C:/Media/one.png','new':'S:/Moved/one.png'}])
        for draft in result.values():self.assertEqual(draft['materials']['videos'][0]['path'],'S:/Moved/one.png')
        for draft in result.values():draft['materials']['videos'][0]['path']='C:/Media/one.png'
        self.assertEqual(result,before);self.assertEqual(drafts,before)

    def test_unknown_jobs_and_unfinished_folder_creation_block_root_repair(self):
        for group in ('AddAttempts','UpdateAttempts','DeleteAttempts','RestoreAttempts','TransferAttempts'):
            job={'BindingId':'binding'}
            if group=='RestoreAttempts':job={'Import':job}
            state={group:[{'Job':job,'Status':'Unknown'}]}
            self.assertTrue(repair.blocked(state,'binding'))
            state[group][0]['Status']='Completed';self.assertFalse(repair.blocked(state,'binding'))
        self.assertTrue(repair.blocked({'ManagedFolders':[{'Job':{'BindingId':'binding'},'Status':'Prepared'}]},'binding'))

    def test_other_files_are_refused_before_native_dispatch_even_if_old_root_is_absent(self):
        with tempfile.TemporaryDirectory(prefix='wakushare-root-proof-') as folder:
            root=Path(folder);target=root/'new';target.mkdir();(target/'one.png').write_bytes(b'different bytes')
            private=root/'private';private.mkdir();project=root/'project';project.mkdir()
            identifier=str(uuid.uuid4());binding={'Id':identifier,'ProjectId':'project','RootPath':str(root/'old'),'Status':'WaitingForRootFolder'}
            source={'Id':str(uuid.uuid4()),'BindingId':identifier,'RelativePath':'one.png','Size':15,'Hash':hashlib.sha256(b'original source').hexdigest(),'MaterialId':'card','AppliedPath':'one.png','AppliedHash':hashlib.sha256(b'original source').hexdigest()}
            context=SimpleNamespace(state={'Bindings':[binding],'Sources':[source]},bindings=[binding],private=private,directory=project,project_key='project')
            data={'bindingId':identifier,'newRoot':str(target),'previousRoots':[str(root/'old')],'editor':{'ProcessId':1,'ViewEpoch':1,'Project':{'Location':str(project),'DraftId':str(uuid.uuid4())}},'token':'a'*64}
            dll=root/'module.dll';dll.write_bytes(b'fixture')
            with patch.object(repair,'ProductScope',return_value=context),patch.object(repair,'check_build'),patch.object(repair,'DLL',dll),patch.object(repair,'MANIFEST',private/'module.json'),patch.object(repair,'load_project',return_value={'meta':{'draft_materials':[]}}),patch.object(repair,'invoke',side_effect=AssertionError('Native mutation must not run')) as native:
                result=repair.execute(data)
            self.assertEqual(result['Status'],'Conflict');self.assertEqual(result['NativeCommands'],0);native.assert_not_called()
            journals=list((private/'root-relocations').glob('*/journal.json'))
            self.assertEqual(len(journals),1);self.assertEqual(json.loads(journals[0].read_bytes())['stage'],'Prepared')

    def test_streamed_hash_is_exact(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'large.bin';data=b'hello'*1000000;path.write_bytes(data)
            self.assertEqual(repair.file_hash(path),hashlib.sha256(data).hexdigest())

    def test_root_folder_keeps_original_receipt_and_requires_exact_ancestry(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);old=root/'old';target=root/'new';identifier=str(uuid.uuid4());receipt=str(uuid.uuid4());binding_id=str(uuid.uuid4())
            job={'Id':identifier,'ProjectId':'project','RootPath':str(target),'SourceDirectory':str(target),'FolderId':identifier,'ParentFolderId':'','Name':'Original name'}
            original={**job,'RootPath':str(old),'SourceDirectory':str(old)}
            marker=root/'native-journal'/identifier/'journal.json';marker.parent.mkdir(parents=True)
            marker.write_text(json.dumps({'kind':'folder','stage':'Verified','job':original,'materialId':identifier}))
            prior_bytes=marker.read_bytes();acceptance=root/'root-relocations'/receipt/'acceptance.json';acceptance.parent.mkdir(parents=True)
            acceptance.write_text(json.dumps({'accepted':True,'bindingId':binding_id,'projectKey':'project','oldRoot':str(old),'newRoot':str(target)}))
            binding={'Id':binding_id,'RootPath':str(target),'MediaFolderId':identifier,'RootMoves':[{'FromRoot':str(old),'ToRoot':str(target),'ReceiptId':receipt}]}
            context=SimpleNamespace(private=root,directory=root,bindings=[binding],project_key='project')
            project={'meta':{'draft_materials':[]},'store':{'draft_virtual_store':[{'type':0,'value':[{'id':identifier,'display_name':'Original name'}]},{'type':1,'value':[{'child_id':identifier,'parent_id':''}]}]}}
            with patch.object(repair,'load_project',return_value=project):
                result=repair.relocated_folder({'kind':'folder','job':job},context)
                self.assertEqual(result['Status'],'Verified');self.assertEqual(result['NativeCommands'],0)
                self.assertEqual(marker.read_bytes(),prior_bytes)
                project['store']['draft_virtual_store'][1]['value'][0]['parent_id']='foreign'
                with self.assertRaises(ValueError):repair.relocated_folder({'kind':'folder','job':job},context)

    def test_cross_volume_repair_preserves_known_sdk_links_and_is_idempotent(self):
        from explorer_project_observations_v1 import read,write
        with tempfile.TemporaryDirectory() as folder:
            private=Path(folder);source={'Id':'source','BindingId':'binding','FileIdentity':'old-volume:id','MaterialId':'card'}
            state={'Bindings':[{'Id':'binding','ProjectId':'project'}],'Sources':[source]}
            link={'ProjectId':'project','BindingId':'binding','SourceId':'source','MaterialId':'card','FileIdentity':'old-volume:id','TimelineSourceIds':['original-sdk-id'],'BinAliasIds':['shadow-id']}
            write(private,'project','source-links.json',[link]);proofs=[{'Id':'source','Identity':'new-volume:id'}]
            repair.carry_physical_links(private,'project','binding',state,proofs,'receipt')
            after=read(private,'project','source-links.json',[])
            self.assertEqual(after[0]['TimelineSourceIds'],link['TimelineSourceIds']);self.assertEqual(after[0]['BinAliasIds'],link['BinAliasIds']);self.assertEqual(after[0]['FileIdentity'],'new-volume:id')
            repair.carry_physical_links(private,'project','binding',state,proofs,'receipt')
            self.assertEqual(read(private,'project','source-links.json',[]),after)

if __name__=='__main__':unittest.main()
