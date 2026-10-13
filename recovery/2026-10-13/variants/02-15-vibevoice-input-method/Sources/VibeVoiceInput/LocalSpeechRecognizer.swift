import Foundation

protocol SpeechRecognizer: AnyObject {
    var onReady: (() -> Void)? { get set }
    var onPartialResult: ((String) -> Void)? { get set }
    var onResult: ((Result<String, Error>) -> Void)? { get set }
    var onExit: ((String) -> Void)? { get set }
    var isRunning: Bool { get }
    func start(binary: URL, vae: URL, lm: URL) throws
    func transcribe(_ audioURL: URL) throws
    func stop()
}

final class ASRServer: SpeechRecognizer {
    var onReady: (() -> Void)?
    var onPartialResult: ((String) -> Void)?
    var onResult: ((Result<String, Error>) -> Void)?
    var onExit: ((String) -> Void)?

    private let process = Process()
    private let stdinPipe = Pipe()
    private let stdoutPipe = Pipe()
    private let stderrPipe = Pipe()
    private var buffer = Data()
    private var transcript = ""
    private var errorLog = ""

    var isRunning: Bool { process.isRunning }

    func start(binary: URL, vae: URL, lm: URL) throws {
        let threadCount = min(8, max(4, ProcessInfo.processInfo.activeProcessorCount))
        process.executableURL = binary
        process.arguments = [
            "--vae-model", vae.path,
            "--lm-model", lm.path,
            "-t", String(threadCount),
            "--greedy"
        ]
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { self?.consume(data) }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.errorLog.append(text)
                if let count = self?.errorLog.count, count > 12_000 {
                    self?.errorLog.removeFirst(count - 12_000)
                }
            }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                let detail = self?.errorLog.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                self?.onExit?(detail.isEmpty ? "识别服务已退出（\(process.terminationStatus)）" : detail)
            }
        }
        try process.run()
    }

    func transcribe(_ audioURL: URL) throws {
        guard process.isRunning else {
            throw NSError(domain: "VibeVoiceInput", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "识别服务没有运行"])
        }
        let safePath = audioURL.path.replacingOccurrences(of: "\n", with: "")
        try stdinPipe.fileHandleForWriting.write(contentsOf: Data((safePath + "\n").utf8))
    }

    func stop() {
        if process.isRunning {
            try? stdinPipe.fileHandleForWriting.write(contentsOf: Data("EXIT\n".utf8))
            process.terminate()
        }
    }

    func consume(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = String(decoding: buffer[..<newline], as: UTF8.self).trimmingCharacters(in: .newlines)
            buffer.removeSubrange(...newline)
            if line == "---READY---" {
                onReady?()
            } else if line == "---END---" {
                let result = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                if result.hasPrefix("[ERROR]") || result.isEmpty {
                    let message = result.isEmpty ? "没有识别到语音" : result
                    onResult?(.failure(NSError(domain: "VibeVoiceInput", code: 3,
                                               userInfo: [NSLocalizedDescriptionKey: message])))
                } else {
                    onResult?(.success(result))
                }
                transcript = ""
            } else if line != "---ACK---" {
                transcript.append(line)
                onPartialResult?(transcript)
            }
        }
    }
}
