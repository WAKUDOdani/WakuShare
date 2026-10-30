from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from explorer_native_runtime_v4 import folder_rejection_stage

class SessionRejections(unittest.TestCase):
 def test_revoked_lease_before_append_can_wait_for_return(self):
  self.assertEqual(folder_rejection_stage({'status':'rejected','reason':'runtime session lease revoked'}),'WaitingForSession')
 def test_file_save_before_append_can_settle(self):
  self.assertEqual(folder_rejection_stage({'status':'rejected','reason':'project document unavailable'}),'WaitingForSession')
 def test_unknown_or_created_operation_is_never_retried(self):
  for status in ['unknown','created','dispatched-unconfirmed']:
   self.assertEqual(folder_rejection_stage({'status':status,'reason':'runtime session lease revoked'}),'Unknown')
 def test_mutation_flags_override_a_rejection_label(self):
  for key in ['folderAppended','mutationDispatched']:
   self.assertEqual(folder_rejection_stage({'status':'rejected','reason':'runtime session lease revoked',key:True}),'Unknown')
 def test_ownership_errors_do_not_loop(self):
  self.assertEqual(folder_rejection_stage({'status':'rejected','reason':'metadata belongs to another active project'}),'RejectedBeforeMutation')

if __name__=='__main__':unittest.main()
