"""Exercise the persistent planner transport on private data, without CapCut."""
from __future__ import annotations

import hashlib
import os
import json
from pathlib import Path
import queue
import subprocess
import threading
import uuid

ROOT = Path(__file__).resolve().parent.parent
DLL = ROOT / 'src/CapSync.Cli/bin/Debug/net10.0/CapSync.Observer.dll'


class Worker:
    def __init__(self, state, editor_pid=None, *, dll=None, native_root=None, native_mode=None, env=None):
        command = ['dotnet', str(dll or DLL), 'event-worker', '--state', str(state)]
        if editor_pid is not None: command += ['--editor-pid', str(editor_pid)]
        if native_root is not None: command += ['--native-root',str(native_root)]
        if native_mode is not None: command += ['--native-mode',native_mode]
        self.process = subprocess.Popen(command,
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', bufsize=1, creationflags=subprocess.CREATE_NO_WINDOW,env={**os.environ,**(env or {})})
        self.messages = queue.Queue()
        self.events = []
        self.sequence = 0
        self.ids = 0
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        for line in self.process.stdout:
            try: self.messages.put(json.loads(line))
            except ValueError: self.messages.put({'badOutput': line})
        self.messages.put(None)

    def receive(self, timeout=10):
        message = self.messages.get(timeout=timeout)
        if message is None: raise AssertionError('Unexpected worker exit: ' + self.process.stderr.read())
        assert message.get('protocolVersion') == 1, message
        assert message['sequence'] == self.sequence + 1, message
        self.sequence = message['sequence']
        return message

    def send(self, raw):
        self.process.stdin.write(raw + '\n')
        self.process.stdin.flush()

    def request(self, command, payload=None, *, request_id=None, raw=None, response_id='auto'):
        self.ids += 1
        request_id = request_id or 'request_' + str(self.ids)
        raw = raw or json.dumps({'protocolVersion': 1, 'requestId': request_id,
                                 'command': command, 'payload': payload or {}}, separators=(',', ':'))
        self.send(raw)
        while True:
            message = self.receive()
            if message['type'] == 'event': self.events.append(message['payload']); continue
            expected = request_id if response_id == 'auto' else response_id
            assert message['requestId'] == expected, message
            return message['payload'], raw

    def event(self, name):
        for index, event in enumerate(self.events):
            if event['name'] == name: return self.events.pop(index)
        while True:
            message = self.receive()
            assert message['type'] == 'event', message
            if message['payload']['name'] == name: return message['payload']
            self.events.append(message['payload'])

    def idle(self, seconds=1):
        try: raise AssertionError('Unexpected idle message: ' + repr(self.messages.get(timeout=seconds)))
        except queue.Empty: pass

    def exited(self, code):
        assert self.process.wait(timeout=8) == code
        self.reader.join(timeout=1)
        stderr = self.process.stderr.read()
        if code == 0: assert not stderr, stderr
        return stderr

    def close(self):
        if self.process.poll() is None:
            if not self.process.stdin.closed: self.process.stdin.close()
            try: self.process.wait(timeout=4)
            except subprocess.TimeoutExpired: self.process.terminate(); self.process.wait(timeout=4)
        self.reader.join(timeout=1)


def main():
    run = ROOT / 'research/evidence' / ('explorer-worker-' + uuid.uuid4().hex)
    source = run / 'sources'; source.mkdir(parents=True)
    state_dir = run / 'state'; state_dir.mkdir()
    state = state_dir / 'state.json'
    image = source / 'a.png'; image.write_bytes(b'before')
    state.write_text(json.dumps({'SchemaVersion': 1, 'Bindings': [{
        'Id': str(uuid.uuid4()), 'ProjectId': 'synthetic-worker-project',
        'MediaFolderId': str(uuid.uuid4()), 'RootPath': str(source)}], 'Sources': [], 'Pending': []}), encoding='utf-8')
    digest = lambda: hashlib.sha256(state.read_bytes()).hexdigest()
    original = digest()
    checks = []
    workers = []
    report = {'accepted': False, 'editorCommands': 0, 'checks': checks}
    try:
        worker = Worker(state); workers.append(worker)
        ready = worker.event('ready')
        assert ready['state']['phase'] == 'Paused' and not ready['capabilities']['nativeDispatch']
        worker.idle(); assert digest() == original
        checks.append('startup paused without disk scan or state rewrite')
        invalid = [
            ('{"protocolVersion":99,"requestId":"bad","command":"start","payload":{}}', 'UnsupportedProtocolVersion'),
            ('{"protocolVersion":"1","requestId":"bad","command":"start","payload":{}}', 'UnsupportedProtocolVersion'),
            ('{"protocolVersion":1,"requestId":"bad","command":"start","payload":{},"payload":{}}', 'DuplicateProperty'),
            ('{"protocolVersion":1,"requestId":"bad","command":"start","payload":null}', 'ExpectedObject'),
            ('{"protocolVersion":1,"requestId":"bad","command":"start","payload":{},"extra":true}', 'UnknownField'),
        ]
        for raw, error in invalid:
            reply, _ = worker.request('', raw=raw, response_id=None)
            assert not reply['ok'] and reply['error'] == error, reply
        reply, _ = worker.request('status')
        assert reply['result']['phase'] == 'Paused' and digest() == original
        checks.append('invalid version, types, duplicate and unknown fields cannot start observation')
        reply, _ = worker.request('start'); assert reply['ok']
        first = worker.event('stateChanged')['state']
        assert first['sources'] == 1 and first['work']['FullScans'] == 1, first
        worker.idle()
        checks.append('start performs one initial batch then waits')
        duplicate_owner = Worker(state); workers.append(duplicate_owner)
        assert duplicate_owner.exited(1)
        assert duplicate_owner.messages.get(timeout=1) is None
        checks.append('second worker cannot acquire the same state')
        reply, _ = worker.request('rescan', {'root': str(source), 'audit': 'true'})
        assert reply['error'] == 'InvalidField:audit'
        reply, _ = worker.request('rescan', {'root': str(run)})
        assert not reply['ok']
        reply, _ = worker.request('import', {'file': str(image)})
        assert reply['error'] == 'UnknownCommand'
        checks.append('bad rescan is rejected and native commands are unavailable')
        reply, raw = worker.request('rescan', {'root': str(source)}, request_id='deduplicate')
        assert reply['ok']
        repeated, _ = worker.request('', raw=raw, request_id='deduplicate')
        assert repeated == reply
        second = worker.event('stateChanged')['state']
        assert second['batches'] == first['batches'] + 1
        worker.idle()
        conflict, _ = worker.request('status', request_id='deduplicate')
        assert conflict['error'] == 'RequestIdConflict'
        checks.append('replay returns its response without another scan; changed request ID conflicts')
        reply, _ = worker.request('session', {'event': 'MediaChanged'}); assert reply['ok']
        media = worker.event('stateChanged')['state']
        assert media['work'] == second['work']
        checks.append('media event plans without rereading source files')
        reply, _ = worker.request('session', {'event': 'Resume'}); assert reply['ok']
        resumed = worker.event('stateChanged')['state']
        assert resumed['work']['FullScans'] == media['work']['FullScans'] + 1
        assert resumed['work']['HashedBytes'] == media['work']['HashedBytes']
        checks.append('resume renews subscriptions and metadata once without rehashing unchanged content')
        reply, _ = worker.request('pause')
        assert reply['result']['phase'] == 'Paused' and reply['result']['watches'] == []
        paused_hash = digest(); image.write_bytes(b'after'); worker.idle()
        assert digest() == paused_hash
        reply, _ = worker.request('start'); assert reply['ok']
        restarted = worker.event('stateChanged')['state']
        assert restarted['runtimeEpoch'] == 2 and restarted['work']['HashedBytes'] == 5
        checks.append('pause releases observation; restart catches changes made while paused')
        worker.process.stdin.close()
        stopped = worker.event('stopped')
        assert stopped['reason'] == 'ParentDisconnected' and stopped['state']['phase'] == 'Stopped'
        worker.exited(0)
        checks.append('parent pipe closure gracefully releases worker')
        oversize = Worker(state); workers.append(oversize); oversize.event('ready')
        oversize.send('x' * 32769)
        assert oversize.event('fault')['code'] == 'FrameTooLarge'
        oversize.exited(2)
        checks.append('oversized input is bounded and closes without modifying state')
        final = Worker(state); workers.append(final); final.event('ready')
        reply, _ = final.request('stop'); assert reply['ok']
        assert final.event('stopped')['reason'] == 'Requested'
        final.exited(0)
        checks.append('fresh worker acquires released locks and stops on request')
        report.update(accepted=True, first=first, restarted=restarted)
    finally:
        for worker in workers: worker.close()
        (run / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'accepted': True, 'checks': len(checks), 'editorCommands': 0,
                      'report': str(run / 'result.json')}, ensure_ascii=False))


if __name__ == '__main__': main()
