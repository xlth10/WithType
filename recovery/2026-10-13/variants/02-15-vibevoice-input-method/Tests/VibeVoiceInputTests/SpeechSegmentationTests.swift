import XCTest
@testable import VibeVoiceInput

final class SpeechSegmentationTests: XCTestCase {
    func testLiveSessionSubmitsASRWorkBeforeRecordingStops() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("vibevoice-live-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        var submittedSampleCounts: [Int] = []
        let session = LiveTranscriptionSession(
            config: .speedFirst,
            temporaryDirectory: directory
        ) { url in
            submittedSampleCounts.append(try PCM16WAV.readSamples(from: url).count)
        }
        var finished: TranscriptAssemblyResult?
        session.onFinished = { finished = $0 }

        let sampleRate = 24_000
        let continuousSpeech = (0..<(sampleRate * 17)).map { index in
            Float(sin(Double(index) * 0.04)) * 0.25
        }
        session.update(samples: continuousSpeech)

        XCTAssertFalse(submittedSampleCounts.isEmpty, "ASR must start while recording is still active")
        XCTAssertLessThan(submittedSampleCounts[0], continuousSpeech.count)

        session.finish(samples: continuousSpeech)
        let expected = (1...submittedSampleCounts.count).map { "第\($0)段" }.joined()
        for index in submittedSampleCounts.indices {
            session.accept(.success("第\(index + 1)段"))
        }
        XCTAssertEqual(finished?.text, expected)
    }

    func testPCM16WAVRoundTrip() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("vibevoice-wav-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let samples: [Float] = [-1, -0.5, 0, 0.5, 1]
        try PCM16WAV.write(samples: samples, sampleRate: 24_000, to: url)
        let decoded = try PCM16WAV.readSamples(from: url)
        XCTAssertEqual(decoded.count, samples.count)
        for (actual, expected) in zip(decoded, samples) {
            XCTAssertEqual(actual, expected, accuracy: 0.0001)
        }
    }

    private let sampleRate = 1_000

    func testContinuousSpeechStaysWhole() {
        let samples = tone(seconds: 24)
        XCTAssertEqual(SpeechSegmenter().plan(samples: samples, sampleRate: sampleRate), [0..<samples.count])
    }

    func testPlansSegmentsAtStablePauses() {
        let samples = tone(seconds: 7) + silence(seconds: 0.6)
            + tone(seconds: 7) + silence(seconds: 0.6)
            + tone(seconds: 7)
        let ranges = SpeechSegmenter().plan(samples: samples, sampleRate: sampleRate)
        XCTAssertEqual(ranges.count, 3)
        XCTAssertEqual(ranges.first?.lowerBound, 0)
        XCTAssertEqual(ranges.last?.upperBound, samples.count)
        XCTAssertTrue(ranges.dropLast().allSatisfy { range in
            let boundarySeconds = Double(range.upperBound) / Double(sampleRate)
            return abs(boundarySeconds - 7.3) < 0.4 || abs(boundarySeconds - 14.9) < 0.4
        })
    }

    func testStableCutKeepsLiveMargin() {
        let segmenter = SpeechSegmenter()
        let earlyPause = tone(seconds: 7) + silence(seconds: 0.6) + tone(seconds: 4)
        XCTAssertNotNil(segmenter.stableCut(in: earlyPause, sampleRate: sampleRate, after: 0))

        let recentPause = tone(seconds: 7) + silence(seconds: 0.6)
        XCTAssertNil(segmenter.stableCut(in: recentPause, sampleRate: sampleRate, after: 0))
    }

    func testAssemblerRemovesOverlapAndReportsPartialResults() {
        let complete = TranscriptAssembler.assemble([
            RecognizedSegment(index: 1, sampleRange: 9..<20, state: .success("我们开会，记得带电脑")),
            RecognizedSegment(index: 0, sampleRange: 0..<12, state: .success("明天下午三点我们开会")),
        ])
        XCTAssertTrue(complete.isComplete)
        XCTAssertEqual(complete.text, "明天下午三点我们开会，记得带电脑")

        let partial = TranscriptAssembler.assemble([
            RecognizedSegment(index: 0, sampleRange: 0..<10, state: .success("第一段")),
            RecognizedSegment(index: 1, sampleRange: 10..<20, state: .failed("推理失败")),
        ])
        XCTAssertFalse(partial.isComplete)
        XCTAssertEqual(partial.text, "第一段")
        XCTAssertEqual(partial.failedSegmentIndexes, [1])
    }

    private func tone(seconds: Double, amplitude: Float = 0.2) -> [Float] {
        (0..<Int(seconds * Double(sampleRate))).map { index in
            sin(Float(index) * 0.13) * amplitude
        }
    }

    private func silence(seconds: Double) -> [Float] {
        [Float](repeating: 0, count: Int(seconds * Double(sampleRate)))
    }
}
