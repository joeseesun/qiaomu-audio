"""Optional external installer. Run manually outside Obsidian; never invoked by the plugin."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import urllib.request
import zipfile


def application_root():
    home = Path.home()
    if sys.platform == 'darwin':
        base = home / 'Library/Application Support'
    elif sys.platform == 'win32':
        base = Path(os.environ.get('LOCALAPPDATA', home / 'AppData/Local'))
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share'))
    return base / 'qiaomu-audio/speech'


def verified_binary(asset, windows=False):
    request = urllib.request.Request(asset['url'], headers={'User-Agent': 'QiaomuAudioExternalSetup/1.0'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != asset['sha256']:
        raise ValueError('Runtime download checksum failed')
    wanted = 'uv.exe' if windows else 'uv'
    if windows:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            matches = [f for f in archive.infolist() if not f.is_dir() and Path(f.filename).name == wanted]
            if len(matches) != 1 or matches[0].file_size > 128 * 1024 * 1024:
                raise ValueError('Invalid runtime archive')
            return archive.read(matches[0])
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        matches = [f for f in archive.getmembers() if f.isfile() and not f.issym() and Path(f.name).name == wanted]
        if len(matches) != 1 or matches[0].size > 128 * 1024 * 1024:
            raise ValueError('Invalid runtime archive')
        return archive.extractfile(matches[0]).read()


def main():
    parser = argparse.ArgumentParser(description='Prepare the optional Qiaomu Audio local runtime outside Obsidian.')
    parser.add_argument('model', choices=['sensevoice', 'kokoro', 'melo'])
    args = parser.parse_args()
    source = Path(__file__).resolve().parent.parent / 'src/runtime/models.json'
    if source.is_file():
        registry = json.loads(source.read_text(encoding='utf-8'))
    else:
        url = 'https://raw.githubusercontent.com/joeseesun/qiaomu-audio/1.0.0/src/runtime/models.json'
        with urllib.request.urlopen(url, timeout=30) as response:
            registry = json.load(response)
    cpu = {'arm64': 'aarch64', 'aarch64': 'aarch64', 'x86_64': 'x86_64', 'amd64': 'x86_64'}.get(platform.machine().lower())
    suffix = {'darwin': 'apple-darwin.tar.gz', 'win32': 'pc-windows-msvc.zip', 'linux': 'unknown-linux-gnu.tar.gz'}.get(sys.platform)
    if not cpu or not suffix:
        raise ValueError('Unsupported platform')
    root = application_root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    executable = root / ('uv.exe' if sys.platform == 'win32' else 'uv')
    # Re-verify the pinned installer on each explicit run; never execute an unknown existing binary.
    binary = verified_binary(registry['uv'][f'uv-{cpu}-{suffix}'], sys.platform == 'win32')
    temp = executable.with_suffix('.tmp')
    temp.write_bytes(binary)
    temp.chmod(0o700)
    temp.replace(executable)
    env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(root / 'python'))
    for key in ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_PREFIX']:
        env.pop(key, None)
    def run(*values, capture=False):
        return subprocess.run([str(executable), *values], env=env, check=True, text=True, capture_output=capture)
    run('python', 'install', registry['python'])
    python = run('python', 'find', registry['python'], '--managed-python', capture=True).stdout.strip()
    venv = root / 'runtimes' / args.model / registry['models'][args.model]['revision']
    interpreter = venv / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if not interpreter.is_file():
        run('venv', '--python', python, str(venv))
    run('pip', 'install', '--python', str(interpreter), *registry['packages'])
    print('Runtime ready. Return to Qiaomu Audio settings, check installation, then download the model.')


if __name__ == '__main__':
    main()
