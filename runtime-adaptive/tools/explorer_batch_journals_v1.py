"""Same durable per-file receipts, with bounded parallel disk flushes."""
import json
from concurrent.futures import ThreadPoolExecutor
from live_add import atomic

def materialize(private,jobs,batch,identifiers,rejected):
    rejected=set(rejected)
    def save(job):
        record={'job':job,'kind':'add','stage':'RejectedFormat' if job['Id'] in rejected else 'Verified','materialId':identifiers.get(job['Id']),'batchId':batch}
        folder=private/'native-journal'/job['Id'];folder.mkdir(parents=True,exist_ok=True);marker=folder/'journal.json'
        if marker.exists():
            if json.loads(marker.read_bytes())!=record:raise ValueError('Individual receipt differs from its verified batch')
        else:atomic(marker,record)
    with ThreadPoolExecutor(max_workers=4) as pool:
        # Wait for every fsync and rename before acknowledging completion.
        list(pool.map(save,jobs))
