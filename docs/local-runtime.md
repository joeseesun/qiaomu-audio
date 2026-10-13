# Optional local speech runtime

Qiaomu Audio uses an optional Python 3.11 / Sherpa ONNX environment for Kokoro, MeloTTS and SenseVoice. The Obsidian plugin does not install or update executable dependencies. Prepare this environment outside Obsidian once, then use **Check installation** and **Download and use** in the plugin. Existing matching environments are reused.

System speech, Mac speech, Edge TTS and cloud providers do not need this setup.

## macOS and Linux

Download [install-local-runtime.py](https://github.com/joeseesun/qiaomu-audio/releases/download/1.0.1/install-local-runtime.py), inspect it, and run it in a terminal with Python 3.9 or newer:

```sh
python3 ~/Downloads/install-local-runtime.py sensevoice
```

For read aloud, replace `sensevoice` with `kokoro` or `melo`.

## Windows

Install Python from [python.org](https://www.python.org/downloads/windows/) if necessary, download the same script, then run in PowerShell:

```powershell
py "$HOME\Downloads\install-local-runtime.py" sensevoice
```

## What the external installer does

The script reads the versioned model registry, downloads a fixed SHA-256 verified `uv` executable from Astral's GitHub releases, and prepares a private Python environment with pinned Sherpa ONNX and NumPy packages. It accesses GitHub, Astral's Python distribution and PyPI. It does not modify your system Python or notes, and it does not run inside Obsidian.

Files are stored outside vaults under `qiaomu-audio/speech` in the platform's application data directory. After installation, the plugin downloads only pinned model data from the upstream Sherpa model releases and verifies their SHA-256 checksums. Recognition and synthesis then run through an authenticated localhost worker. No text or recording is uploaded during local inference.

If the plugin still reports that the environment is missing, rerun the external script for the selected model, then select **Check installation**. The model download supports cancellation and retry. Cloud providers remain available while you set up the local runtime.
