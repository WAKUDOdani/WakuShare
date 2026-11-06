"""Operation-local UI hints, never an acknowledgement or polling source."""
import sys
def stage(phase):
    if phase not in ('preparing','importing','placing','checking'):raise ValueError('Invalid operation stage')
    print('WAKUSHARE_STAGE '+phase,file=sys.stderr,flush=True)
