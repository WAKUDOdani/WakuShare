"""Same private ownership validation, immutable mass-command generation."""
from explorer_product_scope_v2 import ProductScope as PreviousScope
class ProductScope(PreviousScope):
    def invoke(self,pid,adapter,export,request,output):
        from explorer_product_bridge_v3 import invoke_command
        return invoke_command(pid,adapter,export,request,output)
