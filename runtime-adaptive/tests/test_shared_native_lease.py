import unittest,sys,ctypes as C
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import explorer_native_runtime_v3 as v3
import explorer_native_runtime_v4 as v4
from explorer_product_bridge_v5 import ProductBin
class SharedNativeLease(unittest.TestCase):
 def test_all_product_requests_use_the_same_ctypes_lease(self):
  self.assertIs(v3.Lease,v4.Lease)
  lease=v4.Lease(processId=123,viewEpoch=1)
  for request in (ProductBin,v4.Folder,v4.Source,v4.LinkedMove):
   value=request(lease=lease);self.assertEqual(value.lease.processId,123)
   self.assertEqual(C.sizeof(type(value.lease)),C.sizeof(v3.Lease))
