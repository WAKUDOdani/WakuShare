import unittest,tempfile,sys,json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import explorer_project_io_v2 as io
class SnapshotTransaction(unittest.TestCase):
 def test_save_race_retries_reads_before_creating_the_preimage(self):
  with tempfile.TemporaryDirectory() as directory:
   destination=Path(directory)/'snapshot';stable={'draft_content.json':b'{"id":"same"}','draft_meta_info.json':b'{}'};changing={**stable,'draft_content.json':b'{"id":"changing"}'}
   calls=[stable,changing,stable,stable]
   def raw(_):
    self.assertFalse(destination.exists(),'A failed capture must leave no partial preimage')
    return calls.pop(0)
   with patch.object(io,'raw_documents',side_effect=raw),patch.object(io,'read_documents',return_value=stable),patch('explorer_project_io.time.sleep'):
    io.snapshot_project(Path(directory),destination)
   self.assertEqual((destination/'draft_content.json').read_bytes(),stable['draft_content.json'])
   self.assertFalse(calls)
