import unittest,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from adaptive_symbols import CapabilityError
import explorer_product_bridge_v5 as bridge
class AdaptivePreflight(unittest.TestCase):
 def test_unstable_project_stops_before_ownership_planning_or_journaling(self):
  import explorer_product_runtime_v6 as runtime
  import adaptive_context
  data={'action':'execute','kind':'add','editor':{'ProcessId':123}}
  with patch.object(adaptive_context,'bind'),patch.object(bridge,'preflight',side_effect=CapabilityError('add',['live Draft changed'],'project_settling')),patch.object(runtime,'ProductScope') as scope:
   with self.assertRaises(CapabilityError):runtime.run(data)
   scope.assert_not_called()
 def test_missing_rename_interface_never_dispatches_but_does_not_block_add(self):
  def check(pid,operation='read'):
   if operation=='rename':raise CapabilityError('rename',['media.rename'])
   return {}
  with patch.object(bridge,'check_build',side_effect=check),patch.object(bridge,'prepare_commands'),patch.object(bridge,'dispatch',return_value={'status':'created'}) as dispatch:
   with self.assertRaisesRegex(CapabilityError,'AUTOSYNC\\|rename\\|interface_unavailable\\|media.rename'):
    bridge.invoke_command(123,'BinPath','unused',None,None)
   dispatch.assert_not_called()
   self.assertEqual(bridge.invoke_command(123,'Import','unused',None,None),{'status':'created'})
   dispatch.assert_called_once()
 def test_move_and_delete_have_independent_checks(self):
  with patch.object(bridge,'check_build') as check,patch.object(bridge,'prepare_commands'),patch.object(bridge,'dispatch'):
   bridge.invoke_command(123,'TreeMove','unused',None,None);check.assert_called_with(123,'move')
   bridge.invoke_command(123,'Remove','unused',None,None);check.assert_called_with(123,'remove')
