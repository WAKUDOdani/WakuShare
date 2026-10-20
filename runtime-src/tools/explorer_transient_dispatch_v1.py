"""Retry only a proven pre-dispatch rejection, with bounded operation-local waits.

Never retries an import/move/folder append which may have happened. Every receipt
keeps its unique output path. There are no timers when the queue is idle.
"""
import time,json
from live_add import atomic
from pathlib import Path
from explorer_product_bridge_v3 import invoke_command as dispatch

TRANSIENT={'active pointer interaction','project document unavailable'}
def rejected_before_mutation(receipt):
    return receipt.get('status')=='rejected' and not any(receipt.get(k) is True for k in ('dispatched','mutationDispatched')) and any(receipt.get(k) is False for k in ('dispatched','mutationDispatched'))
def transient(receipt):return rejected_before_mutation(receipt) and receipt.get('reason') in TRANSIENT

def invoke_command(pid,adapter,export,request,output):
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    for number,delay in enumerate((0,.25,.75,1.5,3,6)):
        if delay:time.sleep(delay)
        target=output if number==0 else output.with_name(output.stem+f'-not-dispatched-{number}'+output.suffix)
        marker=output.with_name(output.stem+'-dispatch-state.json')
        atomic(marker,{'stage':'Dispatching','attempt':number,'receipt':target.name})
        receipt=dispatch(pid,adapter,export,request,target)
        atomic(marker,{'stage':'Returned','attempt':number,'receipt':target.name,'rejectedBeforeMutation':rejected_before_mutation(receipt)})
        if not transient(receipt):return receipt
    return receipt


def rejected_output(output):
    """A later accepted/unknown callback supersedes an earlier safe rejection."""
    output=Path(output);marker=output.with_name(output.stem+'-dispatch-state.json')
    if marker.exists():
        record=json.loads(marker.read_bytes());number=record.get('attempt')
        if record.get('stage')!='Returned' or record.get('rejectedBeforeMutation') is not True or type(number) is not int or not 0<=number<=5:return False
        target=output if number==0 else output.with_name(output.stem+f'-not-dispatched-{number}'+output.suffix)
        if record.get('receipt')!=target.name:return False
        return target.exists() and rejected_before_mutation(json.loads(target.read_bytes()))
    return output.exists() and rejected_before_mutation(json.loads(output.read_bytes()))
