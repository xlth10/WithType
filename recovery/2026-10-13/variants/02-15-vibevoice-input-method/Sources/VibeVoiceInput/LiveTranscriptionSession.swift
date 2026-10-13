import Foundation

extension SpeechSegmentationConfig {
    /// Favors low post-stop latency over maximum single-segment context.
    static let speedFirst = SpeechSegmentationConfig(
        minimumSilenceSeconds: 0.25,
        minimumSegmentSeconds: 6.0,
        targetSegmentSeconds: 8.0,
        searchRadiusSeconds: 2.0,
        liveMarginSeconds: 0.8
    )
}

enum PCM16WAV {
    enum Error: LocalizedError {
        case invalidFile
        case unsupportedFormat

        var errorDescription: String? {
            switch self {
            case .invalidFile: return "录音文件尚未包含有效 PCM 数据"
            case .unsupportedFormat: return "录音格式不是 24 kHz 单声道 PCM16"
            }
        }
    }

    static func readSamples(from url: URL) throws -> [Float] {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count >= 12,
              ascii(data, 0) == "RIFF",
              ascii(data, 8) == "WAVE" else { throw Error.invalidFile }

        var offset = 12
        var format: UInt16?
        var channels: UInt16?
        var sampleRate: UInt32?
        var bitsPerSample: UInt16?
        var dataStart: Int?

        while offset + 8 <= data.count {
            let chunk = ascii(data, offset)
            let declaredSize = Int(uint32(data, offset + 4))
            let content = offset + 8
            if chunk == "fmt ", content + min(declaredSize, 16) <= data.count, declaredSize >= 16 {
                format = uint16(data, content)
                channels = uint16(data, content + 2)
                sampleRate = uint32(data, content + 4)
                bitsPerSample = uint16(data, content + 14)
            } else if chunk == "data" {
                dataStart = content
                break
            }
            let advance = declaredSize + (declaredSize & 1)
            guard advance >= 0, content + advance > offset else { break }
            offset = content + advance
        }

        guard format == 1, channels == 1, sampleRate == 24_000, bitsPerSample == 16,
              let start = dataStart, start <= data.count else { throw Error.unsupportedFormat }
        let byteCount = (data.count - start) & ~1
        guard byteCount > 0 else { return [] }
        var samples: [Float] = []
        samples.reserveCapacity(byteCount / 2)
        var index = start
        while index < start + byteCount {
            let bits = UInt16(data[index]) | (UInt16(data[index + 1]) << 8)
            samples.append(Float(Int16(bitPattern: bits)) / 32_767)
            index += 2
        }
        return samples
    }

    static func write(samples: ArraySlice<Float>, sampleRate: Int, to url: URL) throws {
        try write(samples: Array(samples), sampleRate: sampleRate, to: url)
    }

    static func write(samples: [Float], sampleRate: Int, to url: URL) throws {
        let payloadBytes = samples.count * 2
        var data = Data()
        data.reserveCapacity(44 + payloadBytes)
        data.append(contentsOf: "RIFF".utf8)
        append(UInt32(36 + payloadBytes), to: &data)
        data.append(contentsOf: "WAVEfmt ".utf8)
        append(UInt32(16), to: &data)
        append(UInt16(1), to: &data)
        append(UInt16(1), to: &data)
        append(UInt32(sampleRate), to: &data)
        append(UInt32(sampleRate * 2), to: &data)
        append(UInt16(2), to: &data)
        append(UInt16(16), to: &data)
        data.append(contentsOf: "data".utf8)
        append(UInt32(payloadBytes), to: &data)
        for sample in samples {
            let value = Int16((min(max(sample, -1), 1) * 32_767).rounded())
            append(UInt16(bitPattern: value), to: &data)
        }
        try data.write(to: url, options: .atomic)
    }

    private static func ascii(_ data: Data, _ offset: Int) -> String {
        guard offset + 4 <= data.count else { return "" }
        return String(decoding: data[offset..<(offset + 4)], as: UTF8.self)
    }

    private static func uint16(_ data: Data, _ offset: Int) -> UInt16 {
        UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
    }

    private static func uint32(_ data: Data, _ offset: Int) -> UInt32 {
        UInt32(data[offset]) |
        (UInt32(data[offset + 1]) << 8) |
        (UInt32(data[offset + 2]) << 16) |
        (UInt32(data[offset + 3]) << 24)
    }

    private static func append<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }
}

final class LiveTranscriptionSession {
    typealias SubmitAudio = (URL) throws -> Void

    var onFinished: ((TranscriptAssemblyResult) -> Void)?
    private(set) var hasSubmittedWork = false

    private struct PendingSegment {
        let index: Int
        let sampleRange: Range<Int>
        let url: URL
    }

    private let sampleRate = 24_000
    private let config: SpeechSegmentationConfig
    private let segmenter: SpeechSegmenter
    private let temporaryDirectory: URL
    private let submitAudio: SubmitAudio
    private var committedIndex = 0
    private var nextIndex = 0
    private var pending: [PendingSegment] = []
    private var recognized: [RecognizedSegment] = []
    private var finishing = false
    private var cancelled = false
    private var delivered = false

    init(
        config: SpeechSegmentationConfig = .speedFirst,
        temporaryDirectory: URL = FileManager.default.temporaryDirectory,
        submitAudio: @escaping SubmitAudio
    ) {
        self.config = config
        self.segmenter = SpeechSegmenter(config: config)
        self.temporaryDirectory = temporaryDirectory
        self.submitAudio = submitAudio
    }

    /// Called with the latest complete sample snapshot while recording is active.
    func update(samples: [Float]) {
        guard !cancelled, !finishing, samples.count > committedIndex else { return }
        submitStableSegments(from: samples)
    }

    /// Queues the final tail. Completion is delivered after every queued ASR result arrives.
    func finish(samples: [Float]) {
        guard !cancelled, !finishing else { return }
        submitStableSegments(from: samples)
        if committedIndex < samples.count {
            submit(range: committedIndex..<samples.count, samples: samples)
            committedIndex = samples.count
        }
        finishing = true
        deliverIfComplete()
    }

    /// Accepts results in the same FIFO order in which audio paths were submitted.
    func accept(_ result: Result<String, Error>) {
        guard !cancelled, !pending.isEmpty else { return }
        let segment = pending.removeFirst()
        try? FileManager.default.removeItem(at: segment.url)
        let state: TranscriptSegmentState
        switch result {
        case .success(let text): state = .success(text)
        case .failure(let error): state = .failed(error.localizedDescription)
        }
        recognized.append(RecognizedSegment(index: segment.index, sampleRange: segment.sampleRange, state: state))
        deliverIfComplete()
    }

    func previewText(currentPartial: String = "") -> String {
        let prefix = TranscriptAssembler.assemble(recognized).text
        return prefix + currentPartial
    }

    func cancel() {
        cancelled = true
        pending.forEach { try? FileManager.default.removeItem(at: $0.url) }
        pending.removeAll()
        onFinished = nil
    }

    private func submitStableSegments(from samples: [Float]) {
        let targetSamples = Int(config.targetSegmentSeconds * Double(sampleRate))
        let liveMarginSamples = Int(config.liveMarginSeconds * Double(sampleRate))
        while samples.count - committedIndex >= targetSamples + liveMarginSamples {
            let tail = Array(samples[committedIndex...])
            let stable = segmenter.stableCut(in: tail, sampleRate: sampleRate, after: 0)
            let localCut = stable ?? targetSamples
            let cut = min(samples.count - liveMarginSamples, committedIndex + localCut)
            guard cut > committedIndex else { break }
            submit(range: committedIndex..<cut, samples: samples)
            committedIndex = cut
        }
    }

    private func submit(range: Range<Int>, samples: [Float]) {
        guard !range.isEmpty else { return }
        let overlap = Int(0.45 * Double(sampleRate))
        let audioStart = max(0, range.lowerBound - overlap)
        let url = temporaryDirectory.appendingPathComponent(
            "vibevoice-segment-\(UUID().uuidString).wav"
        )
        let pendingSegment = PendingSegment(index: nextIndex, sampleRange: range, url: url)
        nextIndex += 1
        do {
            try PCM16WAV.write(samples: samples[audioStart..<range.upperBound], sampleRate: sampleRate, to: url)
            pending.append(pendingSegment)
            try submitAudio(url)
            hasSubmittedWork = true
        } catch {
            if pending.last?.url == url { pending.removeLast() }
            try? FileManager.default.removeItem(at: url)
            recognized.append(RecognizedSegment(
                index: pendingSegment.index,
                sampleRange: range,
                state: .failed(error.localizedDescription)
            ))
        }
    }

    private func deliverIfComplete() {
        guard finishing, pending.isEmpty, !delivered, !cancelled else { return }
        delivered = true
        onFinished?(TranscriptAssembler.assemble(recognized))
    }
}
