import unittest,tempfile,sys,json,uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import explorer_import_completion_v1 as completion
class ImportCompletionGuards(unittest.TestCase):
 def test_uncertain_delivery_is_never_completed_or_replayed(self):
  with tempfile.TemporaryDirectory() as folder:
   context=SimpleNamespace(private=Path(folder));job={'Id':str(uuid.uuid4())};run=context.private/'native-journal'/job['Id'];(run/'evidence').mkdir(parents=True);(run/'before').mkdir()
   (run/'journal.json').write_text(json.dumps({'stage':'Dispatching','kind':'restore','job':job}))
   (run/'native-receipt.json').write_text(json.dumps({'status':'unknown'}));(run/'evidence/import-receipt.json').write_text('{}')
   with patch.object(completion,'read') as read:
    self.assertFalse(completion.complete({'kind':'restore','job':job},context));read.assert_not_called()
   self.assertEqual(json.loads((run/'journal.json').read_bytes())['stage'],'Dispatching')
