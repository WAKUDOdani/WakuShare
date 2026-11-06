import unittest,sys,json,tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import explorer_media_view_v1 as view
class ViewFailureIsolation(unittest.TestCase):
 def test_unknown_view_refresh_does_not_raise_or_replay(self):
  with tempfile.TemporaryDirectory() as folder:
   context=SimpleNamespace(private=Path(folder),directory=Path(folder)/'project',project_key='project-v1-'+'a'*64,invoke=Mock(side_effect=RuntimeError('Native thread completion unknown')))
   data={'editor':{'ProcessId':123,'ViewEpoch':1,'Project':{'Location':folder,'DraftId':'11111111-1111-4111-8111-111111111111'}},'token':'a'*64}
   with patch.object(view,'document_hashes',return_value={'same':'hash'}),patch.object(view,'snapshot_project'):
    self.assertFalse(view.refresh(data,context,mark=True))
    self.assertFalse(view.refresh(data,context,mark=True))
   context.invoke.assert_called_once()
   marker=json.loads(next(Path(folder).glob('media-view-project*.json')).read_bytes())
   self.assertTrue(marker['noAutomaticReplay']);self.assertFalse(marker['contentCommandsAllowed'])
