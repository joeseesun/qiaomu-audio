import Foundation
import Speech
import AVFoundation

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}
func fail(_ code: String) -> Never { emit(["error": code]); exit(1) }
func locale(_ code: String) -> Locale {
    let codes = ["zh": "zh-CN", "en": "en-US", "ja": "ja-JP", "ko": "ko-KR", "yue": "yue-CN", "de": "de-DE", "fr": "fr-FR", "es": "es-ES"]
    return Locale(identifier: codes[code] ?? code)
}

@available(macOS 26, *)
func recognize(_ args: [String]) async throws {
    let code = args.last ?? "zh"
    guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale(code)) else { fail("appleLanguage") }
    let transcriber = SpeechTranscriber(locale: supported, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
    if args.first == "prepare" {
        if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await install.downloadAndInstall()
        }
        emit(["ready": true, "locale": supported.identifier]); return
    }
    let installed = await SpeechTranscriber.installedLocales
    guard installed.contains(where: { $0.identifier == supported.identifier }) else { fail("appleModelMissing") }
    if args.first == "status" { emit(["ready": true, "locale": supported.identifier]); return }
    guard args.first == "transcribe", args.count == 3 else { fail("appleProtocol") }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[1]))
    let analyzer = try await SpeechAnalyzer(inputAudioFile: file, modules: [transcriber], finishAfterFile: true)
    var text = ""
    for try await result in transcriber.results { text += String(result.text.characters) }
    withExtendedLifetime(analyzer) { emit(["text": text]) }
}

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "capture" {
    let tap = SystemAudioTap()
    let queue = DispatchQueue(label: "app.qiaomu.audio.capture")
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    var converter: AVAudioConverter?
    signal(SIGPIPE, SIG_IGN)
    tap.onAudio = { buffer in
        queue.async {
            if converter == nil { converter = AVAudioConverter(from: buffer.format, to: format) }
            guard let converter, let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * 16_000 / buffer.format.sampleRate) + 32) else { return }
            var used = false
            var error: NSError?
            converter.convert(to: output, error: &error) { _, status in
                if used { status.pointee = .noDataNow; return nil }
                used = true; status.pointee = .haveData; return buffer
            }
            guard error == nil, let samples = output.floatChannelData, output.frameLength > 0 else { return }
            emit(["pcm": Data(bytes: samples[0], count: Int(output.frameLength) * 4).base64EncodedString()])
        }
    }
    do { try tap.start(); emit(["ready": true, "rate": 16000]) }
    catch { fail("systemAudioDenied") }
    // Parent closes stdin on stop/unload/crash. No detached recorder can survive it.
    DispatchQueue.global().async {
        _ = FileHandle.standardInput.readDataToEndOfFile()
        tap.stop(); exit(0)
    }
    RunLoop.main.run()
} else {
    if #available(macOS 26, *) {
        Task {
            do { try await recognize(args); exit(0) }
            catch { fail("appleRecognition") }
        }
        RunLoop.main.run()
    } else { fail("applePlatform") }
}
